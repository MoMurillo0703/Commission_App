import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { carrierCoverageAliases } from "@/db/schema";
import { normalizeCoverageValue, type CarrierCoverageAlias } from "@/domain/carrierCoverage";

export async function listCarrierCoverageAliases(db?: AppDatabase, carrierId?: number | null): Promise<CarrierCoverageAlias[]> {
  const database = await resolveDb(db);
  const rows = carrierId
    ? await database.select().from(carrierCoverageAliases).where(eq(carrierCoverageAliases.carrierId, carrierId))
    : await database.select().from(carrierCoverageAliases);
  return rows.map((row) => ({
    carrierId: row.carrierId,
    sourceValue: row.sourceValue,
    lineOfBusinessId: row.lineOfBusinessId,
  }));
}

export async function rememberCarrierCoverageAlias(
  db: AppDatabase | undefined,
  input: { carrierId: number | null | undefined; sourceValue: string | null | undefined; lineOfBusinessId: number },
) {
  const sourceValue = normalizeCoverageValue(input.sourceValue);
  if (!input.carrierId || !sourceValue) return null;
  const database = await resolveDb(db);
  const now = new Date().toISOString();
  const [existing] = await database
    .select()
    .from(carrierCoverageAliases)
    .where(and(
      eq(carrierCoverageAliases.carrierId, input.carrierId),
      eq(carrierCoverageAliases.sourceValue, sourceValue),
    ))
    .limit(1);
  if (existing) {
    if (existing.lineOfBusinessId === input.lineOfBusinessId) return existing;
    const [updated] = await database
      .update(carrierCoverageAliases)
      .set({ lineOfBusinessId: input.lineOfBusinessId, updatedAt: now })
      .where(eq(carrierCoverageAliases.id, existing.id))
      .returning();
    return updated ?? existing;
  }
  const [created] = await database.insert(carrierCoverageAliases).values({
    carrierId: input.carrierId,
    sourceValue,
    lineOfBusinessId: input.lineOfBusinessId,
    createdAt: now,
    updatedAt: now,
  }).returning();
  return created ?? null;
}
