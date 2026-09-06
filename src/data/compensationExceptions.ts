import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import type { PostedCompensationException } from "@/domain/compensationExceptions";
import { listCommissions } from "./commissions";
import { listAllPayouts } from "./payouts";

export async function listPostedCompensationExceptions(
  db: AppDatabase | undefined,
  input: { paidMonth: string; commissionIds?: number[] },
): Promise<PostedCompensationException[]> {
  const database = await resolveDb(db);
  const [commissions, payouts] = await Promise.all([
    listCommissions(database),
    listAllPayouts(database),
  ]);
  const withSnapshot = new Set(
    payouts.filter((payout) => payout.allocationId != null).map((payout) => payout.commissionId),
  );
  const wanted = new Set(input.commissionIds ?? []);
  return commissions.flatMap((row) => {
    if (row.statementMonth !== input.paidMonth) return [];
    if (wanted.size > 0 && !wanted.has(row.id)) return [];
    if (withSnapshot.has(row.id)) return [];
    return [{
      commissionId: row.id,
      groupId: row.groupId,
      groupName: row.groupName,
      lineOfBusinessId: row.lineOfBusinessId,
      lineOfBusinessName: row.lineOfBusinessName,
      paidMonth: row.statementMonth,
      grossCommissionCents: row.grossCommissionCents,
      hasAllocationSnapshot: false,
    }];
  });
}
