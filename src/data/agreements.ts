import { desc, eq } from "drizzle-orm";
import { resolveCompensationAgreement } from "@/domain/agreements";
import { isPaidMonth, paidMonthRangesOverlap, previousPaidMonth } from "@/domain/dates";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { agents, groupCompensationAgreements, groups, linesOfBusiness } from "@/db/schema";
import { getAgent } from "./agents";
import { getGroup } from "./groups";
import { getLineOfBusiness } from "./linesOfBusiness";
import { NotFoundError, ValidationError } from "@/lib/errors";

export type AgreementStatus = "active" | "inactive";

export type AgreementWrite = {
  groupId: number;
  agentId: number;
  lineOfBusinessId: number;
  compensationBps: number;
  effectiveStart: string;
  effectiveEnd?: string | null;
  status?: AgreementStatus;
};

export type AgreementPatch = {
  status?: AgreementStatus;
  effectiveEnd?: string | null;
};

export type AgreementView = {
  id: number;
  groupId: number;
  groupName: string;
  agentId: number;
  agentName: string;
  lineOfBusinessId: number;
  lineOfBusinessName: string;
  compensationBps: number;
  effectiveStart: string;
  effectiveEnd: string | null;
  status: AgreementStatus;
  createdAt: string;
  updatedAt: string;
};

function agreementSelect() {
  return {
    id: groupCompensationAgreements.id,
    groupId: groupCompensationAgreements.groupId,
    groupName: groups.name,
    agentId: groupCompensationAgreements.agentId,
    agentName: agents.name,
    lineOfBusinessId: groupCompensationAgreements.lineOfBusinessId,
    lineOfBusinessName: linesOfBusiness.name,
    compensationBps: groupCompensationAgreements.compensationBps,
    effectiveStart: groupCompensationAgreements.effectiveStart,
    effectiveEnd: groupCompensationAgreements.effectiveEnd,
    status: groupCompensationAgreements.status,
    createdAt: groupCompensationAgreements.createdAt,
    updatedAt: groupCompensationAgreements.updatedAt,
  };
}

function agreementQuery(db: AppDatabase) {
  return db
    .select(agreementSelect())
    .from(groupCompensationAgreements)
    .innerJoin(groups, eq(groupCompensationAgreements.groupId, groups.id))
    .innerJoin(agents, eq(groupCompensationAgreements.agentId, agents.id))
    .innerJoin(linesOfBusiness, eq(groupCompensationAgreements.lineOfBusinessId, linesOfBusiness.id));
}

function asView(row: Omit<AgreementView, "status"> & { status: string }): AgreementView {
  return {
    ...row,
    status: row.status === "inactive" ? "inactive" : "active",
  };
}

function assertPaidMonth(value: string, label: string) {
  if (!isPaidMonth(value)) throw new ValidationError(`${label} must be a month in YYYY-MM format.`);
}

function normalizePeriod(start: string, end: string | null | undefined) {
  assertPaidMonth(start, "Effective start");
  const effectiveEnd = end ?? null;
  if (effectiveEnd != null) assertPaidMonth(effectiveEnd, "Effective end");
  if (effectiveEnd != null && effectiveEnd < start) {
    throw new ValidationError("Effective end cannot be before the start month.");
  }
  return { effectiveStart: start, effectiveEnd };
}

async function assertReferences(db: AppDatabase, input: Pick<AgreementWrite, "groupId" | "agentId" | "lineOfBusinessId">) {
  if (!await getGroup(db, input.groupId)) throw new NotFoundError("Group not found.");
  if (!await getAgent(db, input.agentId)) throw new NotFoundError("Agent not found.");
  if (!await getLineOfBusiness(db, input.lineOfBusinessId)) throw new NotFoundError("Line of business not found.");
}

async function listSiblingAgreements(
  db: AppDatabase,
  groupId: number,
  lineOfBusinessId: number,
  exceptId?: number,
) {
  return (await listAgreements(db)).filter((agreement) => (
    agreement.groupId === groupId
    && agreement.lineOfBusinessId === lineOfBusinessId
    && agreement.id !== exceptId
  ));
}

function overlappingActive(
  agreements: AgreementView[],
  start: string,
  end: string | null,
) {
  return agreements.filter((agreement) => (
    agreement.status === "active"
    && paidMonthRangesOverlap(agreement.effectiveStart, agreement.effectiveEnd, start, end)
  ));
}

export async function listAgreements(db?: AppDatabase): Promise<AgreementView[]> {
  const rows = await agreementQuery(await resolveDb(db))
    .orderBy(desc(groupCompensationAgreements.effectiveStart), desc(groupCompensationAgreements.id));
  return rows.map(asView);
}

export async function listAgreementsForGroup(db: AppDatabase, groupId: number) {
  return (await listAgreements(db)).filter((agreement) => agreement.groupId === groupId);
}

export async function listAgreementsForAgent(db: AppDatabase, agentId: number) {
  return (await listAgreements(db)).filter((agreement) => agreement.agentId === agentId);
}

export async function getAgreement(db: AppDatabase | undefined, id: number) {
  const [row] = await agreementQuery(await resolveDb(db)).where(eq(groupCompensationAgreements.id, id)).limit(1);
  return row ? asView(row) : null;
}

export async function findApplicableAgreement(
  db: AppDatabase,
  query: { groupId: number; agentId: number; lineOfBusinessId: number; paidMonth: string },
) {
  return resolveCompensationAgreement(await listAgreements(db), query);
}

export async function createAgreement(db: AppDatabase | undefined, input: AgreementWrite) {
  const database = await resolveDb(db);
  await assertReferences(database, input);
  if (input.compensationBps <= 0 || input.compensationBps > 10000) {
    throw new ValidationError("Compensation split must be greater than 0 and no more than 100 percent.");
  }
  const period = normalizePeriod(input.effectiveStart, input.effectiveEnd);
  const status = input.status ?? "active";
  const siblings = await listSiblingAgreements(database, input.groupId, input.lineOfBusinessId);

  const inserted = await database.transaction(async (tx) => {
    if (status === "active") {
      for (const prior of overlappingActive(siblings, period.effectiveStart, period.effectiveEnd)) {
        if (prior.effectiveStart >= period.effectiveStart) {
          throw new ValidationError("An active compensation agreement already exists for this group, line, and period.");
        }
        const closeEnd = previousPaidMonth(period.effectiveStart);
        if (closeEnd < prior.effectiveStart) {
          throw new ValidationError("The new start month overlaps the existing agreement start.");
        }
        await tx.update(groupCompensationAgreements)
          .set({ effectiveEnd: closeEnd, updatedAt: new Date().toISOString() })
          .where(eq(groupCompensationAgreements.id, prior.id));
      }
    }

    const now = new Date().toISOString();
    const [row] = await tx.insert(groupCompensationAgreements).values({
      groupId: input.groupId,
      agentId: input.agentId,
      lineOfBusinessId: input.lineOfBusinessId,
      compensationBps: input.compensationBps,
      effectiveStart: period.effectiveStart,
      effectiveEnd: period.effectiveEnd,
      status,
      createdAt: now,
      updatedAt: now,
    }).returning({ id: groupCompensationAgreements.id });
    return row;
  });
  return (await getAgreement(database, inserted.id))!;
}

export async function updateAgreement(db: AppDatabase | undefined, id: number, input: AgreementPatch) {
  const database = await resolveDb(db);
  const existing = await getAgreement(database, id);
  if (!existing) throw new NotFoundError("Compensation agreement not found.");

  const status = input.status ?? existing.status;
  const effectiveEnd = input.effectiveEnd === undefined ? existing.effectiveEnd : input.effectiveEnd;
  const period = normalizePeriod(existing.effectiveStart, effectiveEnd);

  if (status === "active") {
    const overlaps = overlappingActive(
      await listSiblingAgreements(database, existing.groupId, existing.lineOfBusinessId, existing.id),
      existing.effectiveStart,
      period.effectiveEnd,
    );
    if (overlaps.length > 0) {
      throw new ValidationError("An active compensation agreement already exists for this group, line, and period.");
    }
  }

  await database.update(groupCompensationAgreements)
    .set({
      status,
      effectiveEnd: period.effectiveEnd,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(groupCompensationAgreements.id, id));
  return (await getAgreement(database, id))!;
}

export async function listGroupsForAgent(db: AppDatabase, agentId: number) {
  const assigned = await db.select().from(groups).where(eq(groups.primaryAgentId, agentId));
  const agreementGroupIds = new Set((await listAgreementsForAgent(db, agentId)).map((agreement) => agreement.groupId));
  const extra = agreementGroupIds.size === 0
    ? []
    : (await db.select().from(groups)).filter((group) => agreementGroupIds.has(group.id) && group.primaryAgentId !== agentId);
  return [...assigned, ...extra].sort((left, right) => left.name.localeCompare(right.name));
}

export async function listGroupsForAccountManager(db: AppDatabase, accountManagerId: number) {
  return db.select().from(groups).where(eq(groups.accountManagerId, accountManagerId)).orderBy(groups.name);
}

export function filterAgreements(
  agreements: AgreementView[],
  filters: { groupId?: number; agentId?: number },
) {
  return agreements.filter((agreement) => (
    (filters.groupId == null || agreement.groupId === filters.groupId)
    && (filters.agentId == null || agreement.agentId === filters.agentId)
  ));
}

export async function agreementCandidates(db?: AppDatabase) {
  return (await listAgreements(db)).map((agreement) => ({
    id: agreement.id,
    groupId: agreement.groupId,
    agentId: agreement.agentId,
    lineOfBusinessId: agreement.lineOfBusinessId,
    compensationBps: agreement.compensationBps,
    effectiveStart: agreement.effectiveStart,
    effectiveEnd: agreement.effectiveEnd,
    status: agreement.status,
  }));
}
