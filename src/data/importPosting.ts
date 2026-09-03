import { agreementCandidates } from "./agreements";
import { allocationCandidates, listAllocations } from "./allocations";
import { createCommission, listPostedSourceRowKeys } from "./commissions";
import { listAccountManagers } from "./accountManagers";
import { listAgents } from "./agents";
import { listGroups } from "./groups";
import { listLinesOfBusiness } from "./linesOfBusiness";
import { getCarrier, listCarriers } from "./carriers";
import { currentTeamMembers, listTeams } from "./teams";
import { getImportStatement, markImportStatementPosted, saveImportColumnMapping } from "./statements";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { normalizeColumnMapping, type ColumnMapping } from "@/domain/columnMapping";
import { collectUnmatchedImportGroups } from "@/domain/importGroups";
import { collectUnmatchedImportAgents, collectUnmatchedImportLines } from "@/domain/namedImport";
import { validateMappedRows } from "@/domain/importRows";
import { collectMappingBlockers, statementReadiness } from "@/domain/statementReadiness";
import { canReviewRows } from "@/domain/statementWorkflow";
import { NotFoundError, StatementBlockedError, ValidationError } from "@/lib/errors";

async function references(db: AppDatabase, statementCarrierId?: number | null, paidMonth?: string) {
  const statementCarrier = statementCarrierId ? await getCarrier(db, statementCarrierId) : null;
  const [agents, managers, teamRows] = await Promise.all([
    listAgents(db),
    listAccountManagers(db),
    listTeams(db),
  ]);
  const personNames = Object.fromEntries([
    ...agents.map((agent) => [`agent:${agent.id}`, agent.name]),
    ...managers.map((manager) => [`account_manager:${manager.id}`, manager.name]),
  ]);
  const teams = new Map(teamRows.map((team) => [team.id, {
    id: team.id,
    name: team.name,
    members: currentTeamMembers(team, paidMonth ?? "9999-12").map((member) => ({
      personKind: member.personKind,
      personId: member.personId,
      name: member.personName,
      shareBps: member.shareBps,
    })),
  }]));
  return {
    groups: await listGroups(db),
    carriers: await listCarriers(db),
    linesOfBusiness: await listLinesOfBusiness(db),
    agents,
    agreements: await agreementCandidates(db),
    allocations: allocationCandidates(await listAllocations(db)),
    teams,
    personNames,
    statementCarrier,
  };
}

export async function previewImportPosting(db: AppDatabase | undefined, statementId: number, mapping: ColumnMapping) {
  const database = await resolveDb(db);
  const normalizedMapping = normalizeColumnMapping(mapping);
  const statement = await getImportStatement(database, statementId);
  if (!statement) throw new NotFoundError("Statement not found.");
  if (!statement.preview || !canReviewRows(statement.preview)) {
    throw new ValidationError("This statement has no readable rows to review or post.");
  }
  const saved = await saveImportColumnMapping(database, statementId, normalizedMapping);
  const postedKeys = new Set(await listPostedSourceRowKeys(database, statementId));
  const rows = validateMappedRows(
    statement.preview.sheets,
    normalizedMapping,
    statement.paidMonth,
    {
      ...(await references(database, statement.carrierId, statement.paidMonth)),
      groupResolutions: statement.preview.groupResolutions,
      lineResolutions: statement.preview.lineResolutions,
      agentResolutions: statement.preview.agentResolutions,
    },
    postedKeys,
  );
  const unmatchedGroups = collectUnmatchedImportGroups(rows);
  const unmatchedLines = collectUnmatchedImportLines(rows.map((row) => ({ exceptions: row.exceptions, importedName: row.importedLineName })));
  const unmatchedAgents = collectUnmatchedImportAgents(rows.map((row) => ({ exceptions: row.exceptions, importedName: row.importedAgentName })));
  const readyCount = rows.filter((row) => row.status === "ready").length;
  const blockedCount = rows.filter((row) => row.status === "blocked").length;
  const postedCount = rows.filter((row) => row.status === "posted").length;
  const readiness = statementReadiness({
    unmatchedGroups,
    unmatchedLines,
    unmatchedAgents,
    mappingReasons: collectMappingBlockers(rows),
    readyCount,
    blockedCount,
    postedCount,
  });
  return {
    statement: saved,
    paidMonth: statement.paidMonth,
    rows,
    unmatchedGroups,
    unmatchedLines,
    unmatchedAgents,
    readiness,
    readyCount,
    blockedCount,
    postedCount,
  };
}

export async function postImportStatement(db: AppDatabase | undefined, statementId: number, mapping: ColumnMapping) {
  const database = await resolveDb(db);
  const run = async (tx: AppDatabase) => {
    const preview = await previewImportPosting(tx, statementId, mapping);
    if (preview.blockedCount > 0 || preview.unmatchedGroups.length > 0 || preview.unmatchedLines.length > 0 || preview.unmatchedAgents.length > 0 || preview.readiness.blockers.length > 0) {
      throw new StatementBlockedError(
        `This statement was not posted because ${preview.blockedCount} row${preview.blockedCount === 1 ? " is" : "s are"} blocked. Resolve every blocker and review again.`,
        preview.readiness.blockers,
      );
    }
    const posted: number[] = [];
    for (const row of preview.rows) {
      if (row.status !== "ready" || row.groupId == null || row.carrierId == null || row.lineOfBusinessId == null || row.grossCommissionCents == null) continue;
      const created = await createCommission(tx, {
        statementMonth: preview.paidMonth,
        groupId: row.groupId,
        carrierId: row.carrierId,
        lineOfBusinessId: row.lineOfBusinessId,
        agentId: row.agentId,
        premiumCents: row.premiumCents,
        grossCommissionCents: row.grossCommissionCents,
        sourceReference: `import:${statementId}:${row.sourceRowKey}`,
        notes: [row.notes, row.importedGroupName ? `Source group: ${row.importedGroupName}` : null].filter(Boolean).join(" · ") || null,
        premiumMonth: row.premiumMonth,
        importStatementId: statementId,
        sourceRowKey: row.sourceRowKey,
      });
      posted.push(created.id);
    }
    const postedCount = preview.postedCount + posted.length;
    const statement = await markImportStatementPosted(tx, statementId, postedCount, postedCount > 0 ? "posted" : preview.statement.status);
    return { preview, posted, postedCount, statement };
  };

  const result = typeof database.transaction === "function"
    ? await database.transaction(async (tx) => run(tx as unknown as AppDatabase))
    : await run(database);
  const after = await previewImportPosting(database, statementId, mapping);

  return {
    ...after,
    statement: result.statement,
    paidMonth: result.preview.paidMonth,
    postedCount: result.posted.length,
    alreadyPostedCount: result.preview.postedCount,
    blockedCount: after.blockedCount,
    remainingReadyCount: 0,
    commissionIds: result.posted,
  };
}
