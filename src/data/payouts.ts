import { eq } from "drizzle-orm";
import type { SettledPayout } from "@/domain/allocations";
import type { AppDatabase } from "@/db";
import { commissionPayouts } from "@/db/schema";

export type PayoutView = {
  id: number;
  commissionId: number;
  allocationId: number | null;
  recipientType: SettledPayout["recipientType"];
  personKind: SettledPayout["personKind"];
  personId: number | null;
  personName: string | null;
  teamId: number | null;
  teamName: string | null;
  parentPayoutId: number | null;
  allocationBps: number;
  teamInternalBps: number | null;
  compensationCents: number;
  createdAt: string;
};

export async function listPayoutsForCommission(db: AppDatabase, commissionId: number): Promise<PayoutView[]> {
  const rows = await db.select().from(commissionPayouts).where(eq(commissionPayouts.commissionId, commissionId));
  return rows.map((row) => ({
    id: row.id,
    commissionId: row.commissionId,
    allocationId: row.allocationId,
    recipientType: row.recipientType as PayoutView["recipientType"],
    personKind: (row.personKind as PayoutView["personKind"]) ?? null,
    personId: row.personId,
    personName: row.personName,
    teamId: row.teamId,
    teamName: row.teamName,
    parentPayoutId: row.parentPayoutId,
    allocationBps: row.allocationBps,
    teamInternalBps: row.teamInternalBps,
    compensationCents: row.compensationCents,
    createdAt: row.createdAt,
  }));
}

export async function listAllPayouts(db: AppDatabase): Promise<PayoutView[]> {
  const rows = await db.select().from(commissionPayouts);
  return rows.map((row) => ({
    id: row.id,
    commissionId: row.commissionId,
    allocationId: row.allocationId,
    recipientType: row.recipientType as PayoutView["recipientType"],
    personKind: (row.personKind as PayoutView["personKind"]) ?? null,
    personId: row.personId,
    personName: row.personName,
    teamId: row.teamId,
    teamName: row.teamName,
    parentPayoutId: row.parentPayoutId,
    allocationBps: row.allocationBps,
    teamInternalBps: row.teamInternalBps,
    compensationCents: row.compensationCents,
    createdAt: row.createdAt,
  }));
}

export async function replaceCommissionPayouts(
  db: AppDatabase,
  commissionId: number,
  payouts: SettledPayout[],
  allocationId: number | null = null,
) {
  await db.delete(commissionPayouts).where(eq(commissionPayouts.commissionId, commissionId));
  const now = new Date().toISOString();
  const idByKey = new Map<string, number>();
  const parents = payouts.filter((payout) => payout.recipientType !== "team_member");
  const children = payouts.filter((payout) => payout.recipientType === "team_member");
  for (const payout of parents) {
    const [row] = await db.insert(commissionPayouts).values({
      commissionId,
      allocationId,
      recipientType: payout.recipientType,
      personKind: payout.personKind,
      personId: payout.personId,
      personName: payout.personName,
      teamId: payout.teamId,
      teamName: payout.teamName,
      parentPayoutId: null,
      allocationBps: payout.allocationBps,
      teamInternalBps: payout.teamInternalBps,
      compensationCents: payout.compensationCents,
      createdAt: now,
    }).returning({ id: commissionPayouts.id });
    idByKey.set(payout.key, row.id);
  }
  for (const payout of children) {
    await db.insert(commissionPayouts).values({
      commissionId,
      allocationId,
      recipientType: payout.recipientType,
      personKind: payout.personKind,
      personId: payout.personId,
      personName: payout.personName,
      teamId: payout.teamId,
      teamName: payout.teamName,
      parentPayoutId: payout.parentKey ? idByKey.get(payout.parentKey) ?? null : null,
      allocationBps: payout.allocationBps,
      teamInternalBps: payout.teamInternalBps,
      compensationCents: payout.compensationCents,
      createdAt: now,
    });
  }
}
