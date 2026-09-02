import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { accountManagers } from "@/db/schema";
import { isUniqueConstraintError, NotFoundError, ValidationError } from "@/lib/errors";

export async function listAccountManagers(db?: AppDatabase) {
  return (await resolveDb(db)).select().from(accountManagers).orderBy(accountManagers.name);
}

export async function getAccountManager(db: AppDatabase | undefined, id: number) {
  const [row] = await (await resolveDb(db)).select().from(accountManagers).where(eq(accountManagers.id, id)).limit(1);
  return row ?? null;
}

export async function createAccountManager(db: AppDatabase | undefined, input: { name: string }) {
  try {
    const now = new Date().toISOString();
    const [row] = await (await resolveDb(db)).insert(accountManagers).values({ name: input.name.trim(), createdAt: now, updatedAt: now }).returning();
    return row;
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new ValidationError("An account manager with this name already exists.");
    throw error;
  }
}

export async function updateAccountManager(db: AppDatabase | undefined, id: number, input: { name: string }) {
  const database = await resolveDb(db);
  if (!await getAccountManager(database, id)) throw new NotFoundError("Account manager not found.");
  try {
    const [row] = await database.update(accountManagers).set({ name: input.name.trim(), updatedAt: new Date().toISOString() }).where(eq(accountManagers.id, id)).returning();
    return row;
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new ValidationError("An account manager with this name already exists.");
    throw error;
  }
}
