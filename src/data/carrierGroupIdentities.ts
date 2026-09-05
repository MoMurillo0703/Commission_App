import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { carrierGroupIdentities } from "@/db/schema";
import { normalizeExternalGroupNumber, type CarrierGroupIdentity } from "@/domain/carrierGroupIdentity";
import { ValidationError } from "@/lib/errors";

export async function listCarrierGroupIdentities(db?: AppDatabase, carrierId?: number | null): Promise<CarrierGroupIdentity[]> {
  const database = await resolveDb(db);
  const rows = carrierId
    ? await database.select().from(carrierGroupIdentities).where(eq(carrierGroupIdentities.carrierId, carrierId))
    : await database.select().from(carrierGroupIdentities);
  return rows.map((row) => ({
    carrierId: row.carrierId,
    externalGroupNumber: row.externalGroupNumber,
    groupId: row.groupId,
  }));
}

export async function rememberCarrierGroupIdentity(
  db: AppDatabase | undefined,
  input: { carrierId: number | null | undefined; externalGroupNumber: string | null | undefined; groupId: number },
) {
  const externalGroupNumber = normalizeExternalGroupNumber(input.externalGroupNumber);
  if (!input.carrierId || !externalGroupNumber) return null;
  const database = await resolveDb(db);
  const now = new Date().toISOString();
  const [existing] = await database
    .select()
    .from(carrierGroupIdentities)
    .where(and(
      eq(carrierGroupIdentities.carrierId, input.carrierId),
      eq(carrierGroupIdentities.externalGroupNumber, externalGroupNumber),
    ))
    .limit(1);
  if (existing) {
    if (existing.groupId === input.groupId) return existing;
    throw new ValidationError(
      `Carrier group number ${externalGroupNumber} is already linked to another group.`,
    );
  }
  const [created] = await database.insert(carrierGroupIdentities).values({
    carrierId: input.carrierId,
    externalGroupNumber,
    groupId: input.groupId,
    createdAt: now,
    updatedAt: now,
  }).returning();
  return created ?? null;
}
