import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { linesOfBusiness } from "@/db/schema";
import { isUniqueConstraintError, NotFoundError, ValidationError } from "@/lib/errors";

export async function listLinesOfBusiness(db?: AppDatabase) {
  return (await resolveDb(db)).select().from(linesOfBusiness).orderBy(linesOfBusiness.name);
}

export async function getLineOfBusiness(db: AppDatabase | undefined, id: number) {
  const [row] = await (await resolveDb(db)).select().from(linesOfBusiness).where(eq(linesOfBusiness.id, id)).limit(1);
  return row ?? null;
}

export async function createLineOfBusiness(db: AppDatabase | undefined, input: { name: string }) {
  try {
    const now = new Date().toISOString();
    const [row] = await (await resolveDb(db)).insert(linesOfBusiness).values({ name: input.name.trim(), createdAt: now, updatedAt: now }).returning();
    return row;
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new ValidationError("A line of business with this name already exists.");
    throw error;
  }
}

export async function updateLineOfBusiness(db: AppDatabase | undefined, id: number, input: { name: string }) {
  const database = await resolveDb(db);
  if (!await getLineOfBusiness(database, id)) throw new NotFoundError("Line of business not found.");
  try {
    const [row] = await database.update(linesOfBusiness).set({ name: input.name.trim(), updatedAt: new Date().toISOString() }).where(eq(linesOfBusiness.id, id)).returning();
    return row;
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new ValidationError("A line of business with this name already exists.");
    throw error;
  }
}
