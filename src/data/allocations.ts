import { and, desc, eq } from "drizzle-orm";
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
import { allocationConflictReviewMessage, classifyRequestedAllocation, type AllocationTerms } from "@/domain/allocationTerms";
import { isPaidMonth } from "@/domain/dates";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { accountManagers, agents, compensationAllocationEntries, compensationAllocations, groups, linesOfBusiness, teams } from "@/db/schema";
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

async function recipientDirectory(db: AppDatabase) {
  const [agentRows, managerRows, teamRows] = await Promise.all([
    db.select({ id: agents.id, name: agents.name }).from(agents),
    db.select({ id: accountManagers.id, name: accountManagers.name }).from(accountManagers),
    db.select({ id: teams.id, name: teams.name }).from(teams),
  ]);
  return {
    agents: new Map(agentRows.map((row) => [row.id, row.name])),
    managers: new Map(managerRows.map((row) => [row.id, row.name])),
    teams: new Map(teamRows.map((row) => [row.id, row.name])),
  };
}

function labelsFromDirectory(
  entry: { recipientType: string; personKind: string | null; personId: number | null; teamId: number | null },
  directory: Awaited<ReturnType<typeof recipientDirectory>>,
) {
  if (entry.recipientType === "agency") return { personName: "Agency", teamName: null as string | null };
  if (entry.recipientType === "team") {
    return { personName: null as string | null, teamName: entry.teamId != null ? directory.teams.get(entry.teamId) ?? "Team" : "Team" };
  }
  if (entry.personKind === "agent") {
    return { personName: entry.personId != null ? directory.agents.get(entry.personId) ?? "Person" : "Person", teamName: null as string | null };
  }
  return { personName: entry.personId != null ? directory.managers.get(entry.personId) ?? "Person" : "Person", teamName: null as string | null };
}

const allocationSelect = {
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
};

async function hydrateEntries(db: AppDatabase, allocationId: number, directory: Awaited<ReturnType<typeof recipientDirectory>>): Promise<AllocationEntryView[]> {
  const rows = await db
    .select()
    .from(compensationAllocationEntries)
    .where(eq(compensationAllocationEntries.allocationId, allocationId));
  return rows
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id)
    .map((row) => {
      const labels = labelsFromDirectory(row, directory);
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
    });
}

type AllocationHeader = {
  id: number;
  groupId: number;
  groupName: string;
  lineOfBusinessId: number;
  lineOfBusinessName: string;
  effectiveStart: string;
  effectiveEnd: string | null;
  status: string;
  sourceAgreementId: number | null;
  createdAt: string;
  updatedAt: string;
};

async function hydrateAllocationRows(db: AppDatabase, rows: AllocationHeader[]): Promise<AllocationView[]> {
  const directory = await recipientDirectory(db);
  return Promise.all(rows.map(async (row) => ({
    ...row,
    status: asStatus(row.status),
    entries: await hydrateEntries(db, row.id, directory),
  })));
}

export async function listAllocations(db?: AppDatabase): Promise<AllocationView[]> {
  const database = await resolveDb(db);
  const rows = await database
    .select(allocationSelect)
    .from(compensationAllocations)
    .innerJoin(groups, eq(compensationAllocations.groupId, groups.id))
    .innerJoin(linesOfBusiness, eq(compensationAllocations.lineOfBusinessId, linesOfBusiness.id))
    .orderBy(desc(compensationAllocations.effectiveStart), desc(compensationAllocations.id));
  return hydrateAllocationRows(database, rows);
}

export async function listAllocationsForPair(db: AppDatabase, groupId: number, lineOfBusinessId: number) {
  const rows = await db
    .select(allocationSelect)
    .from(compensationAllocations)
    .innerJoin(groups, eq(compensationAllocations.groupId, groups.id))
    .innerJoin(linesOfBusiness, eq(compensationAllocations.lineOfBusinessId, linesOfBusiness.id))
    .where(and(eq(compensationAllocations.groupId, groupId), eq(compensationAllocations.lineOfBusinessId, lineOfBusinessId)));
  return hydrateAllocationRows(db, rows);
}

export async function getAllocation(db: AppDatabase | undefined, id: number) {
  const database = await resolveDb(db);
  const rows = await database
    .select(allocationSelect)
    .from(compensationAllocations)
    .innerJoin(groups, eq(compensationAllocations.groupId, groups.id))
    .innerJoin(linesOfBusiness, eq(compensationAllocations.lineOfBusinessId, linesOfBusiness.id))
    .where(eq(compensationAllocations.id, id));
  return (await hydrateAllocationRows(database, rows))[0] ?? null;
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

function allocationTermsFromWrite(input: AllocationWrite, period: { effectiveStart: string; effectiveEnd: string | null }, status: AllocationStatus): AllocationTerms {
  return {
    groupId: input.groupId,
    lineOfBusinessId: input.lineOfBusinessId,
    effectiveStart: period.effectiveStart,
    effectiveEnd: period.effectiveEnd,
    status,
    entries: input.entries,
  };
}

async function prepareAllocationWrite(db: AppDatabase, input: AllocationWrite) {
  if (!await getGroup(db, input.groupId)) throw new NotFoundError("Group not found.");
  if (!await getLineOfBusiness(db, input.lineOfBusinessId)) throw new NotFoundError("Line of business not found.");
  const period = normalizePeriod(input.effectiveStart, input.effectiveEnd);
  const status = input.status ?? "active";
  try {
    validateAllocationEntries(input.entries, { requireComplete: status === "active" });
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : "Invalid allocation.");
  }
  for (const entry of input.entries) await recipientLabel(db, entry);
  return { period, status };
}

async function writeAllocationRecord(
  tx: AppDatabase,
  input: AllocationWrite,
  period: { effectiveStart: string; effectiveEnd: string | null },
  status: AllocationStatus,
  siblings: AllocationView[],
) {
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
  return row.id;
}

export async function createAllocation(db: AppDatabase | undefined, input: AllocationWrite) {
  const database = await resolveDb(db);
  const prepared = await prepareAllocationWrite(database, input);
  const siblings = await listAllocationsForPair(database, input.groupId, input.lineOfBusinessId);
  const insertedId = await database.transaction(async (tx) => (
    writeAllocationRecord(tx as unknown as AppDatabase, input, prepared.period, prepared.status, siblings)
  ));
  return (await getAllocation(database, insertedId))!;
}

export type BulkAllocationWrite = {
  groupId: number;
  effectiveStart: string;
  effectiveEnd?: string | null;
  status?: AllocationStatus;
  targets: Array<{ lineOfBusinessId: number; entries: AllocationEntryInput[] }>;
};

export type BulkAllocationResult = {
  allocations: AllocationView[];
  createdCount: number;
  reusedCount: number;
};

export async function createAllocationsForLines(
  db: AppDatabase | undefined,
  input: BulkAllocationWrite,
): Promise<BulkAllocationResult> {
  const database = await resolveDb(db);
  if (input.targets.length === 0) throw new ValidationError("Select at least one line of business.");
  const lineIds = input.targets.map((target) => target.lineOfBusinessId);
  if (new Set(lineIds).size !== lineIds.length) {
    throw new ValidationError("Each line of business can be selected only once.");
  }
  if (!await getGroup(database, input.groupId)) throw new NotFoundError("Group not found.");
  const period = normalizePeriod(input.effectiveStart, input.effectiveEnd);
  const status = input.status ?? "active";

  const prepared: Array<{
    write: AllocationWrite;
    terms: AllocationTerms;
    exact: AllocationView | null;
  }> = [];

  for (const target of input.targets) {
    const write = {
      groupId: input.groupId,
      lineOfBusinessId: target.lineOfBusinessId,
      effectiveStart: period.effectiveStart,
      effectiveEnd: period.effectiveEnd,
      status,
      entries: target.entries,
    };
    await prepareAllocationWrite(database, write);
    const siblings = await listAllocationsForPair(database, write.groupId, write.lineOfBusinessId);
    const terms = allocationTermsFromWrite(write, period, status);
    const classified = classifyRequestedAllocation(siblings, terms);
    if (classified.status === "conflict") {
      throw new ValidationError(allocationConflictReviewMessage());
    }
    prepared.push({
      write,
      terms,
      exact: classified.status === "exact" ? siblings.find((row) => row.id === classified.allocation?.id) ?? null : null,
    });
  }

  const reused = prepared.filter((item) => item.exact);
  const toCreate = prepared.filter((item) => !item.exact);
  if (toCreate.length === 0) {
    return {
      allocations: reused.map((item) => item.exact!),
      createdCount: 0,
      reusedCount: reused.length,
    };
  }

  const createdIds = await database.transaction(async (tx) => {
    const ids: number[] = [];
    for (const item of toCreate) {
      const siblings = await listAllocationsForPair(tx as unknown as AppDatabase, item.write.groupId, item.write.lineOfBusinessId);
      const classified = classifyRequestedAllocation(siblings, item.terms);
      if (classified.status === "conflict") {
        throw new ValidationError(allocationConflictReviewMessage());
      }
      if (classified.status === "exact") continue;
      ids.push(await writeAllocationRecord(
        tx as unknown as AppDatabase,
        item.write,
        period,
        status,
        siblings,
      ));
    }
    return ids;
  });

  const created = await Promise.all(createdIds.map((id) => getAllocation(database, id)));
  return {
    allocations: [...reused.map((item) => item.exact!), ...created.filter((row): row is AllocationView => Boolean(row))],
    createdCount: createdIds.length,
    reusedCount: reused.length,
  };
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
      (await listAllocationsForPair(database, existing.groupId, existing.lineOfBusinessId)).filter((allocation) => (
        allocation.id !== existing.id
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
