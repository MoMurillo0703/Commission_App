import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { agents } from "@/db/schema";
import { NotFoundError } from "@/lib/errors";
import { emptyToNull } from "@/lib/validation";

export type AgentWrite = {
  name: string;
  defaultCompensationBps?: number | null;
  notes?: string | null;
};

export async function listAgents(db?: AppDatabase) {
  return (await resolveDb(db)).select().from(agents).orderBy(agents.name);
}

export async function getAgent(db: AppDatabase | undefined, id: number) {
  const [row] = await (await resolveDb(db)).select().from(agents).where(eq(agents.id, id)).limit(1);
  return row ?? null;
}

export async function createAgent(db: AppDatabase | undefined, input: AgentWrite) {
  const now = new Date().toISOString();
  const [row] = await (await resolveDb(db)).insert(agents).values({
    name: input.name.trim(),
    defaultCompensationBps: input.defaultCompensationBps ?? null,
    notes: emptyToNull(input.notes),
    createdAt: now,
    updatedAt: now,
  }).returning();
  return row;
}

export async function updateAgent(db: AppDatabase | undefined, id: number, input: AgentWrite) {
  const database = await resolveDb(db);
  if (!await getAgent(database, id)) throw new NotFoundError("Agent not found.");
  const [row] = await database.update(agents).set({
    name: input.name.trim(),
    defaultCompensationBps: input.defaultCompensationBps ?? null,
    notes: emptyToNull(input.notes),
    updatedAt: new Date().toISOString(),
  }).where(eq(agents.id, id)).returning();
  return row;
}
