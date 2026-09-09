import { sql } from "drizzle-orm";
import type { AppDatabase } from "@/db";

export type AllocationNamespacePair = {
  groupId: number;
  lineOfBusinessId: number;
};

export function allocationNamespacePairs(
  pairs: AllocationNamespacePair[],
): AllocationNamespacePair[] {
  const unique = new Map<string, AllocationNamespacePair>();
  for (const pair of pairs) {
    unique.set(`${pair.groupId}:${pair.lineOfBusinessId}`, pair);
  }
  return [...unique.values()].sort((left, right) => (
    left.groupId - right.groupId || left.lineOfBusinessId - right.lineOfBusinessId
  ));
}

export async function lockAllocationNamespaces(
  db: AppDatabase,
  pairs: AllocationNamespacePair[],
) {
  for (const pair of allocationNamespacePairs(pairs)) {
    await db.execute(sql`SELECT pg_advisory_xact_lock(${pair.groupId}, ${pair.lineOfBusinessId})`);
  }
}
