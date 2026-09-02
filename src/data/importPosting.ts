import { agreementCandidates } from "./agreements";
import { createCommission, listPostedSourceRowKeys } from "./commissions";
import { listAgents } from "./agents";
import { listGroups } from "./groups";
import { listLinesOfBusiness } from "./linesOfBusiness";
import { getCarrier, listCarriers } from "./carriers";
import { getImportStatement, markImportStatementPosted, saveImportColumnMapping } from "./statements";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import type { ColumnMapping } from "@/domain/columnMapping";
import { validateMappedRows } from "@/domain/importRows";
import { NotFoundError, ValidationError } from "@/lib/errors";

async function references(db: AppDatabase, statementCarrierId?: number | null) {
  const statementCarrier = statementCarrierId ? await getCarrier(db, statementCarrierId) : null;
  return {
    groups: await listGroups(db),
    carriers: await listCarriers(db),
    linesOfBusiness: await listLinesOfBusiness(db),
    agents: await listAgents(db),
    agreements: await agreementCandidates(db),
    statementCarrier,
  };
}

export async function previewImportPosting(db: AppDatabase | undefined, statementId: number, mapping: ColumnMapping) {
  const database = await resolveDb(db);
  const statement = await getImportStatement(database, statementId);
  if (!statement) throw new NotFoundError("Statement not found.");
  if (!statement.preview) throw new ValidationError("This statement has no inspected rows to map.");
  const saved = await saveImportColumnMapping(database, statementId, mapping);
  const postedKeys = new Set(await listPostedSourceRowKeys(database, statementId));
  const rows = validateMappedRows(statement.preview.sheets, mapping, statement.paidMonth, await references(database, statement.carrierId), postedKeys);
  return {
    statement: saved,
    paidMonth: statement.paidMonth,
    rows,
    readyCount: rows.filter((row) => row.status === "ready").length,
    blockedCount: rows.filter((row) => row.status === "blocked").length,
    postedCount: rows.filter((row) => row.status === "posted").length,
  };
}

export async function postImportStatement(db: AppDatabase | undefined, statementId: number, mapping: ColumnMapping) {
  const database = await resolveDb(db);
  const preview = await previewImportPosting(database, statementId, mapping);
  const posted: number[] = [];

  for (const row of preview.rows) {
    if (row.status !== "ready" || row.groupId == null || row.carrierId == null || row.lineOfBusinessId == null || row.grossCommissionCents == null) {
      continue;
    }
    const created = await createCommission(database, {
      statementMonth: preview.paidMonth,
      groupId: row.groupId,
      carrierId: row.carrierId,
      lineOfBusinessId: row.lineOfBusinessId,
      agentId: row.agentId,
      premiumCents: row.premiumCents,
      grossCommissionCents: row.grossCommissionCents,
      compensationBps: row.agentId == null ? 0 : row.compensationBps,
      sourceReference: `import:${statementId}:${row.sourceRowKey}`,
      notes: row.notes,
      premiumMonth: row.premiumMonth,
      importStatementId: statementId,
      sourceRowKey: row.sourceRowKey,
    });
    posted.push(created.id);
  }

  const postedCount = preview.postedCount + posted.length;
  const remainingReady = preview.readyCount - posted.length;
  const status = remainingReady > 0 || preview.blockedCount > 0 ? (postedCount > 0 ? "partially_posted" : preview.statement.status) : "posted";
  const statement = await markImportStatementPosted(database, statementId, postedCount, postedCount === 0 && preview.postedCount === 0 ? "mapped" : status);

  return {
    statement,
    paidMonth: preview.paidMonth,
    postedCount: posted.length,
    alreadyPostedCount: preview.postedCount,
    blockedCount: preview.blockedCount,
    remainingReadyCount: remainingReady,
    commissionIds: posted,
    rows: (await previewImportPosting(database, statementId, mapping)).rows,
  };
}
