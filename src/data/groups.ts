import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { groups } from "@/db/schema";
import { getAccountManager } from "./accountManagers";
import { getAgent } from "./agents";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { emptyToNull } from "@/lib/validation";

export type GroupWrite = {
  name: string;
  groupNumber?: string | null;
  notes?: string | null;
  accountManagerId?: number | null;
  primaryAgentId?: number | null;
  /** @deprecated Not used to resolve future commission splits. Prefer group compensation agreements. */
  defaultCompensationBps?: number | null;
};

async function assignmentValues(db: AppDatabase, input: GroupWrite) {
  const accountManagerId = input.accountManagerId ?? null;
  const primaryAgentId = input.primaryAgentId ?? null;
  const defaultCompensationBps = input.defaultCompensationBps ?? null;

  if (accountManagerId != null && !await getAccountManager(db, accountManagerId)) {
    throw new NotFoundError("Account manager not found.");
  }
  if (primaryAgentId != null && !await getAgent(db, primaryAgentId)) {
    throw new NotFoundError("Agent not found.");
  }
  if (defaultCompensationBps != null && (defaultCompensationBps < 0 || defaultCompensationBps > 10000)) {
    throw new ValidationError("Default split must be between 0 and 100 percent.");
  }
  if (defaultCompensationBps != null && primaryAgentId == null) {
    throw new ValidationError("A primary agent is required before a group default split can be saved.");
  }

  return { accountManagerId, primaryAgentId, defaultCompensationBps };
}

export async function listGroups(db?: AppDatabase) {
  return (await resolveDb(db)).select().from(groups).orderBy(groups.name);
}

export async function getGroup(db: AppDatabase | undefined, id: number) {
  const [row] = await (await resolveDb(db)).select().from(groups).where(eq(groups.id, id)).limit(1);
  return row ?? null;
}

export async function createGroup(db: AppDatabase | undefined, input: GroupWrite) {
  const database = await resolveDb(db);
  const now = new Date().toISOString();
  const [row] = await database.insert(groups).values({
    name: input.name.trim(),
    groupNumber: emptyToNull(input.groupNumber),
    notes: emptyToNull(input.notes),
    ...await assignmentValues(database, input),
    createdAt: now,
    updatedAt: now,
  }).returning();
  return row;
}

export async function updateGroup(db: AppDatabase | undefined, id: number, input: GroupWrite) {
  const database = await resolveDb(db);
  if (!await getGroup(database, id)) throw new NotFoundError("Group not found.");
  const [row] = await database.update(groups).set({
    name: input.name.trim(),
    groupNumber: emptyToNull(input.groupNumber),
    notes: emptyToNull(input.notes),
    ...await assignmentValues(database, input),
    updatedAt: new Date().toISOString(),
  }).where(eq(groups.id, id)).returning();
  return row;
}

export async function bulkAssignGroups(
  db: AppDatabase | undefined,
  input: { groupIds: number[]; accountManagerId?: number | null; primaryAgentId?: number | null },
) {
  const { normalizeBulkGroupAssignment } = await import("@/domain/groupBulk");
  const assignment = normalizeBulkGroupAssignment(input);
  const database = await resolveDb(db);
  const patch: { accountManagerId?: number | null; primaryAgentId?: number | null; updatedAt: string } = {
    updatedAt: new Date().toISOString(),
  };
  if (assignment.hasManager) {
    if (assignment.accountManagerId != null && !await getAccountManager(database, assignment.accountManagerId)) {
      throw new NotFoundError("Account manager not found.");
    }
    patch.accountManagerId = assignment.accountManagerId ?? null;
  }
  if (assignment.hasAgent) {
    if (assignment.primaryAgentId != null && !await getAgent(database, assignment.primaryAgentId)) {
      throw new NotFoundError("Agent not found.");
    }
    patch.primaryAgentId = assignment.primaryAgentId ?? null;
  }
  for (const id of assignment.groupIds) {
    if (!await getGroup(database, id)) throw new NotFoundError("Group not found.");
  }
  const updated: Array<typeof groups.$inferSelect> = [];
  await database.transaction(async (tx) => {
    for (const id of assignment.groupIds) {
      const [row] = await tx.update(groups).set(patch).where(eq(groups.id, id)).returning();
      updated.push(row);
    }
  });
  return updated;
}
