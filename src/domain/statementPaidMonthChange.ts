import { fingerprintBuffer } from "./fingerprint";
import { stableJson } from "./compensationCorrection";
import type { AllocationCandidate } from "./allocations";
import { historicalAllocationForPaidMonth } from "./compensationCorrection";
import { payoutIdentityFingerprint } from "./payoutSnapshot";

export const PAID_MONTH_IMPACT = {
  unsettled: "A",
  equivalent_terms: "B",
  different_terms: "C",
  no_allocation: "D",
} as const;

export type PaidMonthImpactClass = keyof typeof PAID_MONTH_IMPACT;

export type PaidMonthInitiator = {
  id: string | null;
  email: string | null;
  name: string | null;
};

export type PaidMonthPayoutLike = {
  recipientType: string;
  personKind?: string | null;
  personId?: number | null;
  personName?: string | null;
  teamId?: number | null;
  teamName?: string | null;
  parentPayoutId?: number | null;
  allocationId?: number | null;
  allocationBps: number;
  teamInternalBps?: number | null;
  compensationCents: number;
};

export function allocationTermsFingerprint(allocation: AllocationCandidate | null) {
  if (!allocation) return "none";
  return stableJson({
    entries: [...allocation.entries]
      .map((entry) => ({
        recipientType: entry.recipientType,
        personKind: entry.personKind ?? null,
        personId: entry.personId ?? null,
        teamId: entry.teamId ?? null,
        compensationBps: entry.compensationBps,
      }))
      .sort((left, right) => (
        left.recipientType.localeCompare(right.recipientType)
        || (left.personKind ?? "").localeCompare(right.personKind ?? "")
        || (left.personId ?? 0) - (right.personId ?? 0)
        || (left.teamId ?? 0) - (right.teamId ?? 0)
        || left.compensationBps - right.compensationBps
      )),
  });
}

export function isImplicitAgencyPayouts(payouts: PaidMonthPayoutLike[]) {
  return payouts.length > 0
    && payouts.every((payout) => payout.allocationId == null)
    && payouts.every((payout) => payout.recipientType === "agency");
}

export function classifyPaidMonthImpact(input: {
  payouts: PaidMonthPayoutLike[];
  corrected: boolean;
  oldAllocation: AllocationCandidate | null;
  newAllocation: AllocationCandidate | null;
}): PaidMonthImpactClass {
  if (input.payouts.length === 0 && !input.corrected) return "unsettled";
  if (!input.newAllocation) {
    if (!input.oldAllocation && isImplicitAgencyPayouts(input.payouts)) return "equivalent_terms";
    return "no_allocation";
  }
  if (allocationTermsFingerprint(input.oldAllocation) === allocationTermsFingerprint(input.newAllocation)) {
    return "equivalent_terms";
  }
  if (!input.oldAllocation && isImplicitAgencyPayouts(input.payouts)) return "different_terms";
  return "different_terms";
}

export function paidMonthImpactAllowsConfirm(impactClass: PaidMonthImpactClass) {
  return impactClass === "unsettled" || impactClass === "equivalent_terms";
}

export function paidMonthPreviewToken(input: {
  statementId: number;
  currentPaidMonth: string;
  newPaidMonth: string;
  commissionIds: number[];
  grossAffectedCents: number;
  payoutFingerprint: string;
}) {
  return fingerprintBuffer(new TextEncoder().encode(stableJson({
    statementId: input.statementId,
    currentPaidMonth: input.currentPaidMonth,
    newPaidMonth: input.newPaidMonth,
    commissionIds: [...input.commissionIds].sort((left, right) => left - right),
    grossAffectedCents: input.grossAffectedCents,
    payoutFingerprint: input.payoutFingerprint,
  })));
}

export function paidMonthRequestFingerprint(input: {
  statementId: number;
  previewToken: string;
  newPaidMonth: string;
  reason: string;
}) {
  return fingerprintBuffer(new TextEncoder().encode(stableJson({
    statementId: input.statementId,
    previewToken: input.previewToken,
    newPaidMonth: input.newPaidMonth,
    reason: input.reason.trim(),
  })));
}

export function statementPayoutFingerprint(
  commissions: Array<{ id: number; payouts: PaidMonthPayoutLike[] }>,
) {
  return fingerprintBuffer(new TextEncoder().encode(stableJson(
    [...commissions]
      .sort((left, right) => left.id - right.id)
      .map((row) => ({ id: row.id, payouts: payoutIdentityFingerprint(row.payouts) })),
  )));
}

export function resolvePaidMonthAllocations(
  allocations: AllocationCandidate[],
  query: { groupId: number; lineOfBusinessId: number },
  oldPaidMonth: string,
  newPaidMonth: string,
) {
  return {
    oldAllocation: historicalAllocationForPaidMonth(allocations, { ...query, paidMonth: oldPaidMonth }),
    newAllocation: historicalAllocationForPaidMonth(allocations, { ...query, paidMonth: newPaidMonth }),
  };
}

export function stalePaidMonthPreviewMessage() {
  return "The paid-month preview no longer matches the current statement. Preview again.";
}
