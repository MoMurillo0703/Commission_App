import { createGroup, listGroups } from "./groups";
import { listAgreements } from "./agreements";
import { previewImportPosting } from "./importPosting";
import { saveImportGroupResolutions } from "./statements";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import type { ColumnMapping } from "@/domain/columnMapping";
import { findNormalizedGroup, type GroupImportResolution } from "@/domain/groupMatch";
import { collectUnmatchedImportGroups, groupNumberConflict, proposedGroupName, type GroupImportDecision } from "@/domain/importGroups";
import { ValidationError } from "@/lib/errors";

export async function reviewImportGroups(db: AppDatabase | undefined, statementId: number, mapping: ColumnMapping) {
  const preview = await previewImportPosting(db, statementId, mapping);
  return {
    ...preview,
    unmatchedGroups: collectUnmatchedImportGroups(preview.rows),
  };
}

export async function confirmImportGroups(
  db: AppDatabase | undefined,
  statementId: number,
  mapping: ColumnMapping,
  decisions: GroupImportDecision[],
) {
  const database = await resolveDb(db);
  const review = await reviewImportGroups(database, statementId, mapping);
  const agreementsBefore = (await listAgreements(database)).length;
  const groups = await listGroups(database);
  const decisionsByKey = new Map(decisions.map((item) => [item.key, item]));

  for (const proposed of review.unmatchedGroups) {
    const decision = decisionsByKey.get(proposed.key) ?? { key: proposed.key, action: "create" as const };
    if (decision.action === "match") {
      if (!groups.find((group) => group.id === decision.existingGroupId)) {
        throw new ValidationError(`Select an existing group for ${proposed.sourceName || proposed.sourceNumber}.`);
      }
      continue;
    }
    if (!proposedGroupName(proposed)) {
      throw new ValidationError("A new group needs a group name or group number.");
    }
  }

  const createdIds: number[] = [];
  const reusedIds: number[] = [];
  const matchedIds: number[] = [];
  const conflicts: string[] = [];
  const resolutions = new Map<string, GroupImportResolution>(
    (review.statement.preview?.groupResolutions ?? []).map((item) => [item.key, item]),
  );

  const run = async (tx: AppDatabase) => {
    let currentGroups = await listGroups(tx);
    for (const proposed of review.unmatchedGroups) {
      const decision = decisionsByKey.get(proposed.key) ?? { key: proposed.key, action: "create" as const };
      if (decision.action === "match") {
        const existing = currentGroups.find((group) => group.id === decision.existingGroupId);
        if (!existing) throw new ValidationError(`Select an existing group for ${proposed.sourceName || proposed.sourceNumber}.`);
        if (groupNumberConflict(existing, proposed.sourceNumber)) {
          conflicts.push(`${proposed.sourceName || proposed.sourceNumber} matched ${existing.name}, which already has a different group number. The existing group was not changed.`);
        }
        matchedIds.push(existing.id);
        resolutions.set(proposed.key, {
          key: proposed.key,
          groupId: existing.id,
          sourceName: proposed.sourceName,
          sourceNumber: proposed.sourceNumber,
          action: "match",
        });
        continue;
      }

      const name = proposedGroupName(proposed);
      if (!name) throw new ValidationError("A new group needs a group name or group number.");
      const already = findNormalizedGroup(currentGroups, proposed.sourceName, proposed.sourceNumber);
      if (already) {
        if (groupNumberConflict(already, proposed.sourceNumber)) {
          conflicts.push(`${name} already exists as ${already.name}. The existing group number was left unchanged.`);
        }
        reusedIds.push(already.id);
        resolutions.set(proposed.key, {
          key: proposed.key,
          groupId: already.id,
          sourceName: proposed.sourceName,
          sourceNumber: proposed.sourceNumber,
          action: "create",
        });
        continue;
      }

      const created = await createGroup(tx, {
        name,
        groupNumber: proposed.sourceNumber,
      });
      createdIds.push(created.id);
      currentGroups = [...currentGroups, created];
      resolutions.set(proposed.key, {
        key: proposed.key,
        groupId: created.id,
        sourceName: proposed.sourceName,
        sourceNumber: proposed.sourceNumber,
        action: "create",
      });
    }

    await saveImportGroupResolutions(tx, statementId, [...resolutions.values()], 0);
  };

  if (typeof database.transaction === "function") {
    await database.transaction(async (tx) => {
      await run(tx as unknown as AppDatabase);
    }, { isolationLevel: "serializable" });
  } else {
    await run(database);
  }

  const after = await reviewImportGroups(database, statementId, mapping);
  if ((await listAgreements(database)).length !== agreementsBefore) {
    throw new ValidationError("Group confirmation must not create compensation agreements.");
  }

  return {
    ...after,
    createdCount: createdIds.length,
    reusedCount: reusedIds.length,
    matchedCount: matchedIds.length,
    conflicts,
    remainingUnmatchedCount: after.unmatchedGroups.length,
  };
}
