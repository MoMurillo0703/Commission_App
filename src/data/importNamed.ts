import { createAgent, listAgents } from "./agents";
import { listAgreements } from "./agreements";
import { previewImportPosting } from "./importPosting";
import { createLineOfBusiness, listLinesOfBusiness } from "./linesOfBusiness";
import { saveImportNamedResolutions } from "./statements";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import type { ColumnMapping } from "@/domain/columnMapping";
import {
  collectUnmatchedImportAgents,
  collectUnmatchedImportLines,
  findNormalizedNamedRecord,
  type NamedImportDecision,
  type NamedImportResolution,
} from "@/domain/namedImport";
import { ValidationError } from "@/lib/errors";

export async function confirmImportLines(
  db: AppDatabase | undefined,
  statementId: number,
  mapping: ColumnMapping,
  decisions: NamedImportDecision[],
) {
  return confirmNamedImports(db, statementId, mapping, decisions, "line");
}

export async function confirmImportAgents(
  db: AppDatabase | undefined,
  statementId: number,
  mapping: ColumnMapping,
  decisions: NamedImportDecision[],
) {
  return confirmNamedImports(db, statementId, mapping, decisions, "agent");
}

async function confirmNamedImports(
  db: AppDatabase | undefined,
  statementId: number,
  mapping: ColumnMapping,
  decisions: NamedImportDecision[],
  kind: "line" | "agent",
) {
  const database = await resolveDb(db);
  const preview = await previewImportPosting(database, statementId, mapping);
  const agreementsBefore = (await listAgreements(database)).length;
  const unmatched = kind === "line"
    ? collectUnmatchedImportLines(preview.rows.map((row) => ({ exceptions: row.exceptions, importedName: row.importedLineName })))
    : collectUnmatchedImportAgents(preview.rows.map((row) => ({ exceptions: row.exceptions, importedName: row.importedAgentName })));
  const decisionsByKey = new Map(decisions.map((item) => [item.key, item]));

  for (const proposed of unmatched) {
    const decision = decisionsByKey.get(proposed.key) ?? { key: proposed.key, action: "create" as const };
    if (decision.action === "match" && !decision.existingId) {
      throw new ValidationError(`Select an existing ${kind === "line" ? "line of business" : "agent"} for ${proposed.sourceName}.`);
    }
    if (decision.action === "create" && !proposed.sourceName) {
      throw new ValidationError(`A new ${kind === "line" ? "line of business" : "agent"} needs a name.`);
    }
  }

  const createdIds: number[] = [];
  const reusedIds: number[] = [];
  const matchedIds: number[] = [];
  const existingResolutions = kind === "line"
    ? preview.statement.preview?.lineResolutions ?? []
    : preview.statement.preview?.agentResolutions ?? [];
  const resolutions = new Map<string, NamedImportResolution>(existingResolutions.map((item) => [item.key, item]));

  const run = async (tx: AppDatabase) => {
    let records = kind === "line" ? await listLinesOfBusiness(tx) : await listAgents(tx);
    for (const proposed of unmatched) {
      const decision = decisionsByKey.get(proposed.key) ?? { key: proposed.key, action: "create" as const };
      if (decision.action === "match") {
        const existing = records.find((record) => record.id === decision.existingId);
        if (!existing) throw new ValidationError(`Select an existing ${kind === "line" ? "line of business" : "agent"} for ${proposed.sourceName}.`);
        matchedIds.push(existing.id);
        resolutions.set(proposed.key, {
          key: proposed.key,
          entityId: existing.id,
          sourceName: proposed.sourceName,
          action: "match",
        });
        continue;
      }

      const already = findNormalizedNamedRecord(records, proposed.sourceName);
      if (already) {
        reusedIds.push(already.id);
        resolutions.set(proposed.key, {
          key: proposed.key,
          entityId: already.id,
          sourceName: proposed.sourceName,
          action: "create",
        });
        continue;
      }

      const created = kind === "line"
        ? await createLineOfBusiness(tx, { name: proposed.sourceName })
        : await createAgent(tx, { name: proposed.sourceName });
      createdIds.push(created.id);
      records = [...records, created];
      resolutions.set(proposed.key, {
        key: proposed.key,
        entityId: created.id,
        sourceName: proposed.sourceName,
        action: "create",
      });
    }

    await saveImportNamedResolutions(tx, statementId, kind, [...resolutions.values()]);
  };

  if (typeof database.transaction === "function") {
    await database.transaction(async (tx) => {
      await run(tx as unknown as AppDatabase);
    }, { isolationLevel: "serializable" });
  } else {
    await run(database);
  }

  const after = await previewImportPosting(database, statementId, mapping);
  if ((await listAgreements(database)).length !== agreementsBefore) {
    throw new ValidationError(`${kind === "line" ? "Line of business" : "Agent"} confirmation must not create compensation agreements.`);
  }

  return {
    ...after,
    createdCount: createdIds.length,
    reusedCount: reusedIds.length,
    matchedCount: matchedIds.length,
    remainingUnmatchedCount: kind === "line" ? after.unmatchedLines.length : after.unmatchedAgents.length,
  };
}
