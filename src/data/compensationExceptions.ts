import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import type { PostedCompensationException } from "@/domain/compensationExceptions";
import { isEligibleAgencyFallback } from "@/domain/compensationFallback";
import { listCommissions } from "./commissions";
import { listCorrectedCommissionIds } from "./compensationCorrections";
import { listAllPayouts } from "./payouts";

export async function listPostedCompensationExceptions(
  db: AppDatabase | undefined,
  input: { paidMonth: string; commissionIds?: number[] },
): Promise<PostedCompensationException[]> {
  const database = await resolveDb(db);
  const [commissions, payouts, corrected] = await Promise.all([
    listCommissions(database),
    listAllPayouts(database),
    listCorrectedCommissionIds(database),
  ]);
  const payoutsByCommission = new Map<number, typeof payouts>();
  for (const payout of payouts) {
    const current = payoutsByCommission.get(payout.commissionId) ?? [];
    current.push(payout);
    payoutsByCommission.set(payout.commissionId, current);
  }
  const wanted = new Set(input.commissionIds ?? []);
  return commissions.flatMap((row) => {
    if (row.statementMonth !== input.paidMonth) return [];
    if (wanted.size > 0 && !wanted.has(row.id)) return [];
    const eligible = isEligibleAgencyFallback({
      commissionId: row.id,
      grossCommissionCents: row.grossCommissionCents,
      agentCompensationCents: row.agentCompensationCents,
      agencyNetCents: row.agencyNetCents,
      payouts: payoutsByCommission.get(row.id) ?? [],
      hasPriorCorrection: corrected.has(row.id),
    });
    if (!eligible) return [];
    return [{
      commissionId: row.id,
      groupId: row.groupId,
      groupName: row.groupName,
      lineOfBusinessId: row.lineOfBusinessId,
      lineOfBusinessName: row.lineOfBusinessName,
      paidMonth: row.statementMonth,
      grossCommissionCents: row.grossCommissionCents,
      carrierId: row.carrierId,
      carrierName: row.carrierName,
      eligibleFallback: true,
    }];
  });
}
