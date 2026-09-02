import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { calculateAgencyNetCents, settleCommission } from "@/domain/compensation";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { agents, carriers, commissionRecords, groups, linesOfBusiness } from "@/db/schema";
import { findApplicableAgreement } from "./agreements";
import { getAgent } from "./agents";
import { getCarrier } from "./carriers";
import { getGroup } from "./groups";
import { getLineOfBusiness } from "./linesOfBusiness";
import { isForeignKeyError, NotFoundError, ValidationError } from "@/lib/errors";
import { emptyToNull } from "@/lib/validation";

export type CommissionWrite = {
  statementMonth: string;
  groupId: number;
  carrierId: number;
  lineOfBusinessId: number;
  agentId?: number | null;
  premiumCents?: number | null;
  grossCommissionCents: number;
  compensationBps?: number | null;
  sourceReference?: string | null;
  notes?: string | null;
  premiumMonth?: string | null;
  importStatementId?: number | null;
  sourceRowKey?: string | null;
};

export type CommissionView = {
  id: number;
  statementMonth: string;
  groupId: number;
  groupName: string;
  carrierId: number;
  carrierName: string;
  lineOfBusinessId: number;
  lineOfBusinessName: string;
  agentId: number | null;
  agentName: string | null;
  premiumCents: number | null;
  grossCommissionCents: number;
  compensationBps: number | null;
  agentCompensationCents: number;
  agencyNetCents: number;
  sourceReference: string | null;
  notes: string | null;
  premiumMonth: string | null;
  importStatementId: number | null;
  sourceRowKey: string | null;
  createdAt: string;
  updatedAt: string;
};

function commissionSelect() {
  return {
    id: commissionRecords.id,
    statementMonth: commissionRecords.statementMonth,
    groupId: commissionRecords.groupId,
    groupName: groups.name,
    carrierId: commissionRecords.carrierId,
    carrierName: carriers.name,
    lineOfBusinessId: commissionRecords.lineOfBusinessId,
    lineOfBusinessName: linesOfBusiness.name,
    agentId: commissionRecords.agentId,
    agentName: agents.name,
    premiumCents: commissionRecords.premiumCents,
    grossCommissionCents: commissionRecords.grossCommissionCents,
    compensationBps: commissionRecords.compensationBps,
    agentCompensationCents: commissionRecords.agentCompensationCents,
    agencyNetCents: commissionRecords.agencyNetCents,
    sourceReference: commissionRecords.sourceReference,
    notes: commissionRecords.notes,
    premiumMonth: commissionRecords.premiumMonth,
    importStatementId: commissionRecords.importStatementId,
    sourceRowKey: commissionRecords.sourceRowKey,
    createdAt: commissionRecords.createdAt,
    updatedAt: commissionRecords.updatedAt,
  };
}

function commissionQuery(db: AppDatabase) {
  return db
    .select(commissionSelect())
    .from(commissionRecords)
    .innerJoin(groups, eq(commissionRecords.groupId, groups.id))
    .innerJoin(carriers, eq(commissionRecords.carrierId, carriers.id))
    .innerJoin(linesOfBusiness, eq(commissionRecords.lineOfBusinessId, linesOfBusiness.id))
    .leftJoin(agents, eq(commissionRecords.agentId, agents.id));
}

type CompensationSnapshot = {
  compensationBps: number | null;
  agentCompensationCents: number;
  agencyNetCents: number;
};

async function assignedAgentId(db: AppDatabase, input: CommissionWrite) {
  if (input.agentId !== undefined) return input.agentId ?? null;
  return (await getGroup(db, input.groupId))?.primaryAgentId ?? null;
}

async function resolveNewCompensation(db: AppDatabase, input: CommissionWrite, agentId: number | null): Promise<CompensationSnapshot> {
  if (!agentId) {
    return settleCommission(input.grossCommissionCents, 0);
  }

  if (!await getAgent(db, agentId)) throw new NotFoundError("Agent not found.");
  if (input.compensationBps != null) {
    return settleCommission(input.grossCommissionCents, input.compensationBps);
  }

  const agreement = await findApplicableAgreement(db, {
    groupId: input.groupId,
    agentId,
    lineOfBusinessId: input.lineOfBusinessId,
    paidMonth: input.statementMonth,
  });
  return settleCommission(input.grossCommissionCents, agreement?.compensationBps ?? 0);
}

async function resolveUpdatedCompensation(
  db: AppDatabase,
  input: CommissionWrite,
  existing: CommissionView,
) {
  const agentUnchanged = (input.agentId ?? null) === existing.agentId;
  if (agentUnchanged && input.compensationBps == null) {
    return {
      compensationBps: existing.compensationBps,
      agentCompensationCents: existing.agentCompensationCents,
      agencyNetCents: calculateAgencyNetCents(input.grossCommissionCents, existing.agentCompensationCents),
    };
  }
  return resolveNewCompensation(db, input, input.agentId ?? null);
}

async function assertReferences(db: AppDatabase, input: CommissionWrite) {
  if (!await getGroup(db, input.groupId)) throw new NotFoundError("Group not found.");
  if (!await getCarrier(db, input.carrierId)) throw new NotFoundError("Carrier not found.");
  if (!await getLineOfBusiness(db, input.lineOfBusinessId)) throw new NotFoundError("Line of business not found.");
}

function valuesFrom(input: CommissionWrite, settled: CompensationSnapshot, timestamp: string) {
  return {
    statementMonth: input.statementMonth,
    groupId: input.groupId,
    carrierId: input.carrierId,
    lineOfBusinessId: input.lineOfBusinessId,
    agentId: input.agentId ?? null,
    premiumCents: input.premiumCents ?? null,
    grossCommissionCents: input.grossCommissionCents,
    compensationBps: input.agentId ? settled.compensationBps : null,
    agentCompensationCents: settled.agentCompensationCents,
    agencyNetCents: settled.agencyNetCents,
    sourceReference: emptyToNull(input.sourceReference),
    notes: emptyToNull(input.notes),
    premiumMonth: emptyToNull(input.premiumMonth),
    importStatementId: input.importStatementId ?? null,
    sourceRowKey: emptyToNull(input.sourceRowKey),
    updatedAt: timestamp,
  };
}

export async function listCommissions(db?: AppDatabase): Promise<CommissionView[]> {
  return commissionQuery(await resolveDb(db)).orderBy(desc(commissionRecords.statementMonth), desc(commissionRecords.id));
}

export async function getCommission(db: AppDatabase | undefined, id: number): Promise<CommissionView | null> {
  const [row] = await commissionQuery(await resolveDb(db)).where(eq(commissionRecords.id, id)).limit(1);
  return row ?? null;
}

export async function createCommission(db: AppDatabase | undefined, input: CommissionWrite): Promise<CommissionView> {
  const database = await resolveDb(db);
  await assertReferences(database, input);
  const now = new Date().toISOString();
  const agentId = await assignedAgentId(database, input);
  const resolved = { ...input, agentId };
  try {
    const [inserted] = await database.insert(commissionRecords).values({
      ...valuesFrom(resolved, await resolveNewCompensation(database, resolved, agentId), now),
      createdAt: now,
    }).returning({ id: commissionRecords.id });
    return (await getCommission(database, inserted.id))!;
  } catch (error) {
    if (isForeignKeyError(error)) throw new ValidationError("Commission records must reference existing groups, carriers, lines of business, and agents.");
    throw error;
  }
}

export async function updateCommission(db: AppDatabase | undefined, id: number, input: CommissionWrite): Promise<CommissionView> {
  const database = await resolveDb(db);
  const existing = await getCommission(database, id);
  if (!existing) throw new NotFoundError("Commission record not found.");
  await assertReferences(database, input);
  await database.update(commissionRecords)
    .set(valuesFrom(input, await resolveUpdatedCompensation(database, input, existing), new Date().toISOString()))
    .where(eq(commissionRecords.id, id));
  return (await getCommission(database, id))!;
}

export async function countUnassignedCommissions(db?: AppDatabase) {
  const database = await resolveDb(db);
  const [row] = await database.select({ count: sql<number>`count(*)` }).from(commissionRecords).where(isNull(commissionRecords.agentId));
  return Number(row?.count ?? 0);
}

export async function listPostedSourceRowKeys(db: AppDatabase, importStatementId: number) {
  const rows = await db
    .select({ sourceRowKey: commissionRecords.sourceRowKey })
    .from(commissionRecords)
    .where(and(eq(commissionRecords.importStatementId, importStatementId), isNotNull(commissionRecords.sourceRowKey)));
  return rows.flatMap((row) => (row.sourceRowKey ? [row.sourceRowKey] : []));
}
