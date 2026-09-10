import { createGroup, listGroups } from "./groups";
import { listAgreements } from "./agreements";
import { rememberCarrierGroupIdentity } from "./carrierGroupIdentities";
import { previewImportPosting } from "./importPosting";
import { saveImportGroupResolutions } from "./statements";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import type { ColumnMapping } from "@/domain/columnMapping";
import { findNormalizedGroup, type GroupImportResolution } from "@/domain/groupMatch";
import { collectUnmatchedImportGroups, groupNumberConflict, proposedGroupName, type GroupImportDecision, type UnmatchedImportGroup } from "@/domain/importGroups";
import { ValidationError } from "@/lib/errors";

export async function reviewImportGroups(db: AppDatabase | undefined, statementId: number, mapping: ColumnMapping) {
  const preview = await previewImportPosting(db, statementId, mapping);
  return {
    ...preview,
    unmatchedGroups: collectUnmatchedImportGroups(preview.rows),
  };
}

function proposedFromResolution(resolution: GroupImportResolution): UnmatchedImportGroup {
  return {
    key: resolution.key,
    sourceName: resolution.sourceName,
    sourceNumber: resolution.sourceNumber,
    rowCount: 0,
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
  const unmatchedByKey = new Map(review.unmatchedGroups.map((item) => [item.key, item]));
  const existingResolutions = new Map((review.statement.preview?.groupResolutions ?? []).map((item) => [item.key, item]));
  const explicit = decisions.filter((item) => item.action === "create" || item.action === "match" || item.action === "ignore" || item.action === "reopen");

  const targets: Array<{ proposed: UnmatchedImportGroup; decision: GroupImportDecision }> = [];
  for (const decision of explicit) {
    const proposed = unmatchedByKey.get(decision.key) ?? (
      existingResolutions.get(decision.key) ? proposedFromResolution(existingResolutions.get(decision.key)!) : null
    );
    if (!proposed) continue;
    targets.push({ proposed, decision });
  }

  for (const { proposed, decision } of targets) {
    if (decision.action === "ignore" || decision.action === "reopen") continue;
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
  const resolutions = new Map<string, GroupImportResolution>(existingResolutions);

  const run = async (tx: AppDatabase) => {
    let currentGroups = await listGroups(tx);
    for (const { proposed, decision } of targets) {
      if (decision.action === "reopen") {
        resolutions.delete(proposed.key);
        continue;
      }
      if (decision.action === "ignore") {
        resolutions.set(proposed.key, {
          key: proposed.key,
          groupId: null,
          sourceName: proposed.sourceName,
          sourceNumber: proposed.sourceNumber,
          action: "ignore",
        });
        continue;
      }
      if (decision.action === "match") {
        const existing = currentGroups.find((group) => group.id === decision.existingGroupId);
        if (!existing) throw new ValidationError(`Select an existing group for ${proposed.sourceName || proposed.sourceNumber}.`);
        if (groupNumberConflict(existing, proposed.sourceNumber)) {
          conflicts.push(`${proposed.sourceName || proposed.sourceNumber} matched ${existing.name}, which already has a different group number. The existing group was not changed.`);
        }
        await rememberCarrierGroupIdentity(tx, {
          carrierId: review.statement.carrierId,
          externalGroupNumber: proposed.sourceNumber,
          groupId: existing.id,
        });
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
        await rememberCarrierGroupIdentity(tx, {
          carrierId: review.statement.carrierId,
          externalGroupNumber: proposed.sourceNumber,
          groupId: already.id,
        });
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

      const carrierScopedIdentity = /cal(?:ifornia)?\s*choice/i.test(review.statement.carrierName ?? "")
        || review.statement.preview?.pdf?.groupMatchStrategy === "carrier_group_identity";
      const created = await createGroup(tx, {
        name,
        groupNumber: carrierScopedIdentity ? null : proposed.sourceNumber,
      });
      await rememberCarrierGroupIdentity(tx, {
        carrierId: review.statement.carrierId,
        externalGroupNumber: proposed.sourceNumber,
        groupId: created.id,
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

    const remaining = review.unmatchedGroups.filter((group) => !resolutions.has(group.key)).length;
    await saveImportGroupResolutions(tx, statementId, [...resolutions.values()], remaining);
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
