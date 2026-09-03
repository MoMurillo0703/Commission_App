import { desc, eq } from "drizzle-orm";
import {
  closePriorAllocationEnd,
  overlappingActiveAllocations,
  resolveCompensationAllocation,
  validateAllocationEntries,
  type AllocationCandidate,
  type AllocationEntryInput,
  type AllocationStatus,
  type PersonKind,
  type RecipientType,
} from "@/domain/allocations";
import { isPaidMonth } from "@/domain/dates";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { compensationAllocationEntries, compensationAllocations, groups, linesOfBusiness } from "@/db/schema";
import { getAccountManager } from "./accountManagers";
import { getAgent } from "./agents";
import { getGroup } from "./groups";
import { getLineOfBusiness } from "./linesOfBusiness";
import { getTeam } from "./teams";
import { NotFoundError, ValidationError } from "@/lib/errors";

export type AllocationEntryView = {
  id: number;
  recipientType: RecipientType;
  personKind: PersonKind | null;
  personId: number | null;
  personName: string | null;
  teamId: number | null;
  teamName: string | null;
  compensationBps: number;
  sortOrder: number;
};

export type AllocationView = {
  id: number;
  groupId: number;
  groupName: string;
  lineOfBusinessId: number;
  lineOfBusinessName: string;
  effectiveStart: string;
  effectiveEnd: string | null;
  status: AllocationStatus;
  sourceAgreementId: number | null;
  entries: AllocationEntryView[];
  createdAt: string;
  updatedAt: string;
};

export type AllocationWrite = {
  groupId: number;
  lineOfBusinessId: number;
  effectiveStart: string;
  effectiveEnd?: string | null;
  status?: AllocationStatus;
  entries: AllocationEntryInput[];
};

function asStatus(value: string): AllocationStatus {
  return value === "inactive" ? "inactive" : "active";
}

function normalizePeriod(start: string, end: string | null | undefined) {
  if (!isPaidMonth(start)) throw new ValidationError("Effective start must be a month in YYYY-MM format.");
  const effectiveEnd = end ?? null;
  if (effectiveEnd != null && !isPaidMonth(effectiveEnd)) {
    throw new ValidationError("Effective end must be a month in YYYY-MM format.");
  }
  if (effectiveEnd != null && effectiveEnd < start) {
    throw new ValidationError("Effective end cannot be before the start month.");
  }
  return { effectiveStart: start, effectiveEnd };
}

async function recipientLabel(
  db: AppDatabase,
  entry: AllocationEntryInput,
) {
  if (entry.recipientType === "agency") return { personName: "Agency", teamName: null as string | null };
  if (entry.recipientType === "team") {
    const team = await getTeam(db, entry.teamId!);
    if (!team) throw new NotFoundError("Team not found.");
    return { personName: null as string | null, teamName: team.name };
  }
  if (entry.personKind === "agent") {
    const agent = await getAgent(db, entry.personId!);
    if (!agent) throw new NotFoundError("Person not found.");
    return { personName: agent.name, teamName: null as string | null };
  }
  const manager = await getAccountManager(db, entry.personId!);
  if (!manager) throw new NotFoundError("Person not found.");
  return { personName: manager.name, teamName: null as string | null };
}

async function hydrateEntries(db: AppDatabase, allocationId: number): Promise<AllocationEntryView[]> {
  const rows = await db
    .select()
    .from(compensationAllocationEntries)
    .where(eq(compensationAllocationEntries.allocationId, allocationId));
  const sorted = rows.sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id);
  return Promise.all(sorted.map(async (row) => {
    const labels = await recipientLabel(db, {
      recipientType: row.recipientType as RecipientType,
      personKind: row.personKind as PersonKind | null,
      personId: row.personId,
      teamId: row.teamId,
      compensationBps: row.compensationBps,
    });
    return {
      id: row.id,
      recipientType: row.recipientType as RecipientType,
      personKind: (row.personKind as PersonKind | null) ?? null,
      personId: row.personId,
      personName: labels.personName,
      teamId: row.teamId,
      teamName: labels.teamName,
      compensationBps: row.compensationBps,
      sortOrder: row.sortOrder,
    };
  }));
}

export async function listAllocations(db?: AppDatabase): Promise<AllocationView[]> {
  const database = await resolveDb(db);
  const rows = await database
    .select({
      id: compensationAllocations.id,
      groupId: compensationAllocations.groupId,
      groupName: groups.name,
      lineOfBusinessId: compensationAllocations.lineOfBusinessId,
      lineOfBusinessName: linesOfBusiness.name,
      effectiveStart: compensationAllocations.effectiveStart,
      effectiveEnd: compensationAllocations.effectiveEnd,
      status: compensationAllocations.status,
      sourceAgreementId: compensationAllocations.sourceAgreementId,
      createdAt: compensationAllocations.createdAt,
      updatedAt: compensationAllocations.updatedAt,
    })
    .from(compensationAllocations)
    .innerJoin(groups, eq(compensationAllocations.groupId, groups.id))
    .innerJoin(linesOfBusiness, eq(compensationAllocations.lineOfBusinessId, linesOfBusiness.id))
    .orderBy(desc(compensationAllocations.effectiveStart), desc(compensationAllocations.id));
  return Promise.all(rows.map(async (row) => ({
    ...row,
    status: asStatus(row.status),
    entries: await hydrateEntries(database, row.id),
  })));
}

export async function getAllocation(db: AppDatabase | undefined, id: number) {
  return (await listAllocations(db)).find((allocation) => allocation.id === id) ?? null;
}

export function allocationCandidates(rows: AllocationView[]): AllocationCandidate[] {
  return rows.map((allocation) => ({
    id: allocation.id,
    groupId: allocation.groupId,
    lineOfBusinessId: allocation.lineOfBusinessId,
    effectiveStart: allocation.effectiveStart,
    effectiveEnd: allocation.effectiveEnd,
    status: allocation.status,
    entries: allocation.entries.map((entry) => ({
      recipientType: entry.recipientType,
      personKind: entry.personKind,
      personId: entry.personId,
      teamId: entry.teamId,
      compensationBps: entry.compensationBps,
    })),
  }));
}

export async function findApplicableAllocation(
  db: AppDatabase,
  query: { groupId: number; lineOfBusinessId: number; paidMonth: string },
) {
  const rows = await listAllocations(db);
  const candidate = resolveCompensationAllocation(allocationCandidates(rows), query);
  return candidate ? rows.find((row) => row.id === candidate.id) ?? null : null;
}

export async function createAllocation(db: AppDatabase | undefined, input: AllocationWrite) {
  const database = await resolveDb(db);
  if (!await getGroup(database, input.groupId)) throw new NotFoundError("Group not found.");
  if (!await getLineOfBusiness(database, input.lineOfBusinessId)) throw new NotFoundError("Line of business not found.");
  const period = normalizePeriod(input.effectiveStart, input.effectiveEnd);
  const status = input.status ?? "active";
  try {
    validateAllocationEntries(input.entries, { requireComplete: status === "active" });
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : "Invalid allocation.");
  }
  for (const entry of input.entries) await recipientLabel(database, entry);

  const siblings = (await listAllocations(database)).filter((allocation) => (
    allocation.groupId === input.groupId
    && allocation.lineOfBusinessId === input.lineOfBusinessId
  ));

  const inserted = await database.transaction(async (tx) => {
    if (status === "active") {
      for (const prior of overlappingActiveAllocations(siblings, period.effectiveStart, period.effectiveEnd)) {
        if (prior.effectiveStart >= period.effectiveStart) {
          throw new ValidationError("An active compensation allocation already exists for this group, line, and period.");
        }
        const closeEnd = closePriorAllocationEnd(period.effectiveStart);
        if (closeEnd < prior.effectiveStart) {
          throw new ValidationError("The new start month overlaps the existing allocation start.");
        }
        await tx.update(compensationAllocations)
          .set({ effectiveEnd: closeEnd, updatedAt: new Date().toISOString() })
          .where(eq(compensationAllocations.id, prior.id));
      }
    }
    const now = new Date().toISOString();
    const [row] = await tx.insert(compensationAllocations).values({
      groupId: input.groupId,
      lineOfBusinessId: input.lineOfBusinessId,
      effectiveStart: period.effectiveStart,
      effectiveEnd: period.effectiveEnd,
      status: "inactive",
      createdAt: now,
      updatedAt: now,
    }).returning({ id: compensationAllocations.id });
    for (const [index, entry] of input.entries.entries()) {
      await tx.insert(compensationAllocationEntries).values({
        allocationId: row.id,
        recipientType: entry.recipientType,
        personKind: entry.personKind ?? null,
        personId: entry.personId ?? null,
        teamId: entry.teamId ?? null,
        compensationBps: entry.compensationBps,
        sortOrder: index,
      });
    }
    if (status === "active") {
      await tx.update(compensationAllocations)
        .set({ status: "active", updatedAt: now })
        .where(eq(compensationAllocations.id, row.id));
    }
    return row;
  });
  return (await getAllocation(database, inserted.id))!;
}

export async function updateAllocation(
  db: AppDatabase | undefined,
  id: number,
  input: { status?: AllocationStatus; effectiveEnd?: string | null },
) {
  const database = await resolveDb(db);
  const existing = await getAllocation(database, id);
  if (!existing) throw new NotFoundError("Compensation allocation not found.");
  const status = input.status ?? existing.status;
  const effectiveEnd = input.effectiveEnd === undefined ? existing.effectiveEnd : input.effectiveEnd;
  const period = normalizePeriod(existing.effectiveStart, effectiveEnd);
  if (status === "active") {
    try {
      validateAllocationEntries(existing.entries, { requireComplete: true });
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : "Allocation must total exactly 100 percent.");
    }
    const overlaps = overlappingActiveAllocations(
      (await listAllocations(database)).filter((allocation) => (
        allocation.groupId === existing.groupId
        && allocation.lineOfBusinessId === existing.lineOfBusinessId
        && allocation.id !== existing.id
      )),
      existing.effectiveStart,
      period.effectiveEnd,
    );
    if (overlaps.length > 0) {
      throw new ValidationError("An active compensation allocation already exists for this group, line, and period.");
    }
  }
  await database.update(compensationAllocations)
    .set({ status, effectiveEnd: period.effectiveEnd, updatedAt: new Date().toISOString() })
    .where(eq(compensationAllocations.id, id));
  return (await getAllocation(database, id))!;
}
