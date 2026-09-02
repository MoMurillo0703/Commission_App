import { eq } from "drizzle-orm";
import { matchNamedRecord } from "@/domain/nameMatch";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { carriers } from "@/db/schema";
import { isUniqueConstraintError, NotFoundError, ValidationError } from "@/lib/errors";

export async function listCarriers(db?: AppDatabase) {
  return (await resolveDb(db)).select().from(carriers).orderBy(carriers.name);
}

export async function getCarrier(db: AppDatabase | undefined, id: number) {
  const [row] = await (await resolveDb(db)).select().from(carriers).where(eq(carriers.id, id)).limit(1);
  return row ?? null;
}

export async function createCarrier(db: AppDatabase | undefined, input: { name: string }) {
  try {
    const now = new Date().toISOString();
    const [row] = await (await resolveDb(db)).insert(carriers).values({ name: input.name.trim(), createdAt: now, updatedAt: now }).returning();
    return row;
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new ValidationError("A carrier with this name already exists.");
    throw error;
  }
}

export async function resolveStatementCarrier(
  db: AppDatabase | undefined,
  input: { carrierId?: number | null; carrierName?: string | null },
) {
  const database = await resolveDb(db);
  const name = input.carrierName?.trim() || null;
  if (name) {
    const match = matchNamedRecord(await listCarriers(database), name);
    if (match.status === "matched" && match.id != null) {
      return { carrier: (await getCarrier(database, match.id))!, created: false };
    }
    if (match.status === "ambiguous") {
      throw new ValidationError(`Carrier name matches more than one record: ${name}.`);
    }
    return { carrier: await createCarrier(database, { name }), created: true };
  }

  if (input.carrierId != null) {
    const carrier = await getCarrier(database, input.carrierId);
    if (!carrier) throw new NotFoundError("Carrier not found.");
    return { carrier, created: false };
  }

  throw new ValidationError("Select an existing carrier or enter a new carrier name.");
}

export async function updateCarrier(db: AppDatabase | undefined, id: number, input: { name: string }) {
  const database = await resolveDb(db);
  if (!await getCarrier(database, id)) throw new NotFoundError("Carrier not found.");
  try {
    const [row] = await database.update(carriers).set({ name: input.name.trim(), updatedAt: new Date().toISOString() }).where(eq(carriers.id, id)).returning();
    return row;
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new ValidationError("A carrier with this name already exists.");
    throw error;
  }
}
