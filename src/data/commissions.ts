import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  allocationFromExplicitAgentOverride,
  implicitAgencyAllocation,
  previewCompensationBps,
  settleAllocation,
  type PersonKind,
  type SettledAllocation,
} from "@/domain/allocations";
import { calculateAgencyNetCents, calculateAgentCompensationCents } from "@/domain/compensation";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { agents, carriers, commissionRecords, groups, linesOfBusiness } from "@/db/schema";
import { getAgent, listAgents } from "./agents";
import { listAccountManagers } from "./accountManagers";
import { findApplicableAgreement } from "./agreements";
import { findApplicableAllocation } from "./allocations";
import { getCarrier } from "./carriers";
import { getGroup } from "./groups";
import { getLineOfBusiness } from "./linesOfBusiness";
import { replaceCommissionPayouts } from "./payouts";
import { currentTeamMembers, listTeams } from "./teams";
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
  sourceCoverageLabel?: string | null;
  sourceGroupLabel?: string | null;
  sourceLobLabel?: string | null;
  sourcePeriodLabel?: string | null;
};

export type CommissionPatch = {
  statementMonth?: string;
  groupId?: number;
  carrierId?: number;
  lineOfBusinessId?: number;
  agentId?: number | null;
  premiumCents?: number | null;
  grossCommissionCents?: number;
  compensationBps?: number | null;
  sourceReference?: string | null;
  notes?: string | null;
  premiumMonth?: string | null;
  importStatementId?: number | null;
  sourceRowKey?: string | null;
  sourceCoverageLabel?: string | null;
  sourceGroupLabel?: string | null;
  sourceLobLabel?: string | null;
  sourcePeriodLabel?: string | null;
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
  sourceCoverageLabel: string | null;
  sourceGroupLabel: string | null;
  sourceLobLabel: string | null;
  sourcePeriodLabel: string | null;
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
    sourceCoverageLabel: commissionRecords.sourceCoverageLabel,
    sourceGroupLabel: commissionRecords.sourceGroupLabel,
    sourceLobLabel: commissionRecords.sourceLobLabel,
    sourcePeriodLabel: commissionRecords.sourcePeriodLabel,
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
  settled: SettledAllocation | null;
  allocationId: number | null;
};

async function assignedAgentId(db: AppDatabase, input: CommissionWrite) {
  if (input.agentId !== undefined) return input.agentId ?? null;
  return (await getGroup(db, input.groupId))?.primaryAgentId ?? null;
}

async function personNameLookup(db: AppDatabase) {
  const [agentRows, managerRows] = await Promise.all([listAgents(db), listAccountManagers(db)]);
  const names = new Map<string, string>([
    ...agentRows.map((agent) => [`agent:${agent.id}`, agent.name] as const),
    ...managerRows.map((manager) => [`account_manager:${manager.id}`, manager.name] as const),
  ]);
  return (kind: PersonKind, id: number) => names.get(`${kind}:${id}`) ?? "Person";
}

async function teamShareMap(db: AppDatabase, paidMonth: string) {
  const rows = await listTeams(db);
  return new Map(rows.map((team) => [team.id, {
    id: team.id,
    name: team.name,
    members: currentTeamMembers(team, paidMonth).map((member) => ({
      personKind: member.personKind,
      personId: member.personId,
      name: member.personName,
      shareBps: member.shareBps,
    })),
  }]));
}

function snapshotFromSettled(settled: SettledAllocation, agentId: number | null, allocationId: number | null = null): CompensationSnapshot {
  return {
    compensationBps: previewCompensationBps(settled, agentId),
    agentCompensationCents: settled.compensationDistributedCents,
    agencyNetCents: settled.agencyNetCents,
    settled,
    allocationId,
  };
}

async function legacyAgreementSnapshot(
  db: AppDatabase,
  grossCommissionCents: number,
  agentId: number,
  compensationBps: number,
): Promise<CompensationSnapshot> {
  const agent = await getAgent(db, agentId);
  if (!agent) throw new NotFoundError("Agent not found.");
  const personCents = calculateAgentCompensationCents(grossCommissionCents, compensationBps);
  return snapshotFromSettled({
    allocatedBps: compensationBps,
    remainingBps: 10000 - compensationBps,
    complete: compensationBps === 10000,
    compensationDistributedCents: personCents,
    agencyNetCents: calculateAgencyNetCents(grossCommissionCents, personCents),
    payouts: [{
      recipientType: "person",
      personKind: "agent",
      personId: agentId,
      personName: agent.name,
      teamId: null,
      teamName: null,
      parentKey: null,
      allocationBps: compensationBps,
      teamInternalBps: null,
      compensationCents: personCents,
      key: `legacy:agent:${agentId}`,
    }],
  }, agentId);
}

export async function settleCommissionCompensation(
  db: AppDatabase,
  input: CommissionWrite,
  agentId: number | null,
): Promise<CompensationSnapshot> {
  const names = { agencyName: "Murillo Insurance", personName: await personNameLookup(db) };
  const allocation = await findApplicableAllocation(db, {
    groupId: input.groupId,
    lineOfBusinessId: input.lineOfBusinessId,
    paidMonth: input.statementMonth,
  });
  if (allocation) {
    if (input.compensationBps != null && agentId) {
      const agent = await getAgent(db, agentId);
      if (!agent) throw new NotFoundError("Agent not found.");
      return snapshotFromSettled(settleAllocation(
        input.grossCommissionCents,
        allocationFromExplicitAgentOverride(input.compensationBps, { personKind: "agent", personId: agentId, name: agent.name }),
        new Map(),
        names,
      ), agentId);
    }
    return snapshotFromSettled(settleAllocation(
      input.grossCommissionCents,
      allocation.entries,
      await teamShareMap(db, input.statementMonth),
      names,
    ), agentId, allocation.id);
  }

  if (input.compensationBps != null) {
    if (agentId && !await getAgent(db, agentId)) throw new NotFoundError("Agent not found.");
    if (!agentId) return snapshotFromSettled(implicitAgencyAllocation(input.grossCommissionCents, "Murillo Insurance"), null);
    const agent = await getAgent(db, agentId);
    return snapshotFromSettled(settleAllocation(
      input.grossCommissionCents,
      allocationFromExplicitAgentOverride(input.compensationBps, { personKind: "agent", personId: agentId, name: agent?.name ?? "Agent" }),
      new Map(),
      names,
    ), agentId);
  }

  if (agentId) {
    if (!await getAgent(db, agentId)) throw new NotFoundError("Agent not found.");
    const agreement = await findApplicableAgreement(db, {
      groupId: input.groupId,
      agentId,
      lineOfBusinessId: input.lineOfBusinessId,
      paidMonth: input.statementMonth,
    });
    if (agreement) {
      return legacyAgreementSnapshot(db, input.grossCommissionCents, agentId, agreement.compensationBps);
    }
  }

  return snapshotFromSettled(implicitAgencyAllocation(input.grossCommissionCents, "Murillo Insurance"), agentId);
}

async function resolveNewCompensation(db: AppDatabase, input: CommissionWrite, agentId: number | null): Promise<CompensationSnapshot> {
  return settleCommissionCompensation(db, input, agentId);
}

function mergeCommissionPatch(existing: CommissionView, patch: CommissionPatch): CommissionWrite {
  return {
    statementMonth: patch.statementMonth ?? existing.statementMonth,
    groupId: patch.groupId ?? existing.groupId,
    carrierId: patch.carrierId ?? existing.carrierId,
    lineOfBusinessId: patch.lineOfBusinessId ?? existing.lineOfBusinessId,
    agentId: patch.agentId !== undefined ? patch.agentId : existing.agentId,
    premiumCents: patch.premiumCents !== undefined ? patch.premiumCents : existing.premiumCents,
    grossCommissionCents: patch.grossCommissionCents ?? existing.grossCommissionCents,
    compensationBps: Object.prototype.hasOwnProperty.call(patch, "compensationBps")
      ? patch.compensationBps
      : undefined,
    sourceReference: patch.sourceReference !== undefined ? patch.sourceReference : existing.sourceReference,
    notes: patch.notes !== undefined ? patch.notes : existing.notes,
    premiumMonth: patch.premiumMonth !== undefined ? patch.premiumMonth : existing.premiumMonth,
    importStatementId: patch.importStatementId !== undefined ? patch.importStatementId : existing.importStatementId,
    sourceRowKey: patch.sourceRowKey !== undefined ? patch.sourceRowKey : existing.sourceRowKey,
    sourceCoverageLabel: patch.sourceCoverageLabel !== undefined ? patch.sourceCoverageLabel : existing.sourceCoverageLabel,
    sourceGroupLabel: patch.sourceGroupLabel !== undefined ? patch.sourceGroupLabel : existing.sourceGroupLabel,
    sourceLobLabel: patch.sourceLobLabel !== undefined ? patch.sourceLobLabel : existing.sourceLobLabel,
    sourcePeriodLabel: patch.sourcePeriodLabel !== undefined ? patch.sourcePeriodLabel : existing.sourcePeriodLabel,
  };
}

async function resolveUpdatedCompensation(
  db: AppDatabase,
  patch: CommissionPatch,
  merged: CommissionWrite,
  existing: CommissionView,
): Promise<CompensationSnapshot> {
  const agentId = merged.agentId ?? null;
  const agentUnchanged = agentId === existing.agentId;
  if (agentUnchanged && !Object.prototype.hasOwnProperty.call(patch, "compensationBps")) {
    return {
      compensationBps: existing.compensationBps,
      agentCompensationCents: existing.agentCompensationCents,
      agencyNetCents: calculateAgencyNetCents(merged.grossCommissionCents, existing.agentCompensationCents),
      settled: null,
      allocationId: null,
    };
  }
  return resolveNewCompensation(db, merged, agentId);
}

async function assertReferences(db: AppDatabase, input: CommissionWrite) {
  if (!await getGroup(db, input.groupId)) throw new NotFoundError("Group not found.");
  if (!await getCarrier(db, input.carrierId)) throw new NotFoundError("Carrier not found.");
  if (!await getLineOfBusiness(db, input.lineOfBusinessId)) throw new NotFoundError("Line of business not found.");
}

function valuesFrom(input: CommissionWrite, settled: CompensationSnapshot, timestamp: string, existing?: CommissionView) {
  return {
    statementMonth: input.statementMonth,
    groupId: input.groupId,
    carrierId: input.carrierId,
    lineOfBusinessId: input.lineOfBusinessId,
    agentId: input.agentId !== undefined ? input.agentId ?? null : existing?.agentId ?? null,
    premiumCents: input.premiumCents !== undefined ? input.premiumCents ?? null : existing?.premiumCents ?? null,
    grossCommissionCents: input.grossCommissionCents,
    compensationBps: (input.agentId !== undefined ? input.agentId : existing?.agentId) ? settled.compensationBps : null,
    agentCompensationCents: settled.agentCompensationCents,
    agencyNetCents: settled.agencyNetCents,
    sourceReference: input.sourceReference !== undefined ? emptyToNull(input.sourceReference) : existing?.sourceReference ?? null,
    notes: input.notes !== undefined ? emptyToNull(input.notes) : existing?.notes ?? null,
    premiumMonth: input.premiumMonth !== undefined ? emptyToNull(input.premiumMonth) : existing?.premiumMonth ?? null,
    importStatementId: input.importStatementId !== undefined ? input.importStatementId ?? null : existing?.importStatementId ?? null,
    sourceRowKey: input.sourceRowKey !== undefined ? emptyToNull(input.sourceRowKey) : existing?.sourceRowKey ?? null,
    sourceCoverageLabel: input.sourceCoverageLabel !== undefined ? emptyToNull(input.sourceCoverageLabel) : existing?.sourceCoverageLabel ?? null,
    sourceGroupLabel: input.sourceGroupLabel !== undefined ? emptyToNull(input.sourceGroupLabel) : existing?.sourceGroupLabel ?? null,
    sourceLobLabel: input.sourceLobLabel !== undefined ? emptyToNull(input.sourceLobLabel) : existing?.sourceLobLabel ?? null,
    sourcePeriodLabel: input.sourcePeriodLabel !== undefined ? emptyToNull(input.sourcePeriodLabel) : existing?.sourcePeriodLabel ?? null,
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
    const inserted = await database.transaction(async (tx) => {
      const transaction = tx as unknown as AppDatabase;
      const settled = await resolveNewCompensation(transaction, resolved, agentId);
      const [row] = await transaction.insert(commissionRecords).values({
        ...valuesFrom(resolved, settled, now),
        createdAt: now,
      }).returning({ id: commissionRecords.id });
      if (settled.settled) {
        await replaceCommissionPayouts(transaction, row.id, settled.settled.payouts, settled.allocationId);
      }
      return row;
    });
    return (await getCommission(database, inserted.id))!;
  } catch (error) {
    if (isForeignKeyError(error)) throw new ValidationError("Commission records must reference existing groups, carriers, lines of business, and agents.");
    throw error;
  }
}

export async function updateCommission(db: AppDatabase | undefined, id: number, input: CommissionPatch): Promise<CommissionView> {
  const database = await resolveDb(db);
  const existing = await getCommission(database, id);
  if (!existing) throw new NotFoundError("Commission record not found.");
  const merged = mergeCommissionPatch(existing, input);
  await assertReferences(database, merged);
  try {
    await database.transaction(async (tx) => {
      const transaction = tx as unknown as AppDatabase;
      const settled = await resolveUpdatedCompensation(transaction, input, merged, existing);
      await transaction.update(commissionRecords)
        .set(valuesFrom(merged, settled, new Date().toISOString(), existing))
        .where(eq(commissionRecords.id, id));
      if (settled.settled) {
        await replaceCommissionPayouts(transaction, id, settled.settled.payouts, settled.allocationId);
      }
    });
  } catch (error) {
    if (isForeignKeyError(error)) throw new ValidationError("Commission records must reference existing groups, carriers, lines of business, and agents.");
    throw error;
  }
  return (await getCommission(database, id))!;
}

export async function countUnassignedCommissions(db?: AppDatabase) {
  const database = await resolveDb(db);
  const [row] = await database.select({ count: sql<number>`count(*)` }).from(commissionRecords).where(isNull(commissionRecords.agentId));
  return Number(row?.count ?? 0);
}

export async function listPostedGroupLobMonths(db?: AppDatabase) {
  const database = await resolveDb(db);
  return database
    .select({
      groupId: commissionRecords.groupId,
      lineOfBusinessId: commissionRecords.lineOfBusinessId,
      paidMonth: commissionRecords.statementMonth,
    })
    .from(commissionRecords);
}

export async function listPostedGroupCarrierCoverageMonths(db?: AppDatabase) {
  const database = await resolveDb(db);
  return database
    .select({
      groupId: commissionRecords.groupId,
      carrierId: commissionRecords.carrierId,
      lineOfBusinessId: commissionRecords.lineOfBusinessId,
      paidMonth: commissionRecords.statementMonth,
      coverageMonth: commissionRecords.premiumMonth,
      grossCommissionCents: commissionRecords.grossCommissionCents,
    })
    .from(commissionRecords);
}

export async function listPostedSourceRowKeys(db: AppDatabase, importStatementId: number) {
  const rows = await db
    .select({ sourceRowKey: commissionRecords.sourceRowKey })
    .from(commissionRecords)
    .where(and(eq(commissionRecords.importStatementId, importStatementId), isNotNull(commissionRecords.sourceRowKey)));
  return rows.flatMap((row) => (row.sourceRowKey ? [row.sourceRowKey] : []));
}
