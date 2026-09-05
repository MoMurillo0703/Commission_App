import type { IndividualReportRow } from "./reports";

export type UnallocatedPostedCommission = {
  commissionId: number;
  groupName: string;
  lineOfBusinessName: string;
  paidMonth: string;
  grossCommissionCents: number;
};

export type RecipientPayableReadiness = {
  payableReady: boolean;
  unallocated: UnallocatedPostedCommission[];
  message: string | null;
};

export function formatAllocationPercent(bps: number) {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

export function recipientPayableReadiness(input: {
  assignedGroupIds: number[];
  postedCommissions: Array<{
    id: number;
    groupId: number;
    groupName: string;
    lineOfBusinessName: string;
    paidMonth: string;
    grossCommissionCents: number;
    hasAllocation: boolean;
  }>;
}): RecipientPayableReadiness {
  const unallocated = input.postedCommissions
    .filter((row) => input.assignedGroupIds.includes(row.groupId) && !row.hasAllocation)
    .map((row) => ({
      commissionId: row.id,
      groupName: row.groupName,
      lineOfBusinessName: row.lineOfBusinessName,
      paidMonth: row.paidMonth,
      grossCommissionCents: row.grossCommissionCents,
    }));
  return {
    payableReady: unallocated.length === 0,
    unallocated,
    message: unallocated.length === 0
      ? null
      : `${unallocated.length} posted commission${unallocated.length === 1 ? "" : "s"} on this person's assigned groups ${unallocated.length === 1 ? "has" : "have"} no complete allocation. ${unallocated.length === 1 ? "It settled" : "They settled"} as 100% Agency and ${unallocated.length === 1 ? "is" : "are"} not included as producer pay. Confirm compensation before treating this statement as payable-ready.`,
  };
}

export function recipientStatementDisclaimer() {
  return "This statement shows amounts calculated as payable from posted commissions and stored payout snapshots. Generating it does not mean the recipient has been paid.";
}

export function sourceCommissionIds(rows: Array<Pick<IndividualReportRow, "commissionId">>) {
  return [...new Set(rows.flatMap((row) => row.commissionId == null ? [] : [row.commissionId]))].sort((left, right) => left - right);
}

export type RecipientReviewKind = "ready" | "legitimate_zero" | "missing_payouts" | "unknown_person" | "no_commissions";

export function recipientReportReviewState(input: {
  personSelected: boolean;
  personName: string | null;
  payoutRowCount: number;
  payableCents: number;
  postedCommissionCount: number;
  matchingCommissionCount: number;
  unallocatedCount: number;
}) {
  if (!input.personSelected || !input.personName) {
    return {
      kind: "unknown_person" as const,
      emptyMessage: "Choose an Agent or Account Manager. The statement uses that person's stored payout rows, not a generic Recipient label.",
      showPayableTotals: false,
    };
  }
  if (input.payoutRowCount > 0 && input.payableCents === 0) {
    return {
      kind: "legitimate_zero" as const,
      emptyMessage: null,
      showPayableTotals: true,
    };
  }
  if (input.payoutRowCount > 0) {
    return {
      kind: "ready" as const,
      emptyMessage: null,
      showPayableTotals: true,
    };
  }
  if (input.matchingCommissionCount === 0) {
    return {
      kind: "no_commissions" as const,
      emptyMessage: input.postedCommissionCount === 0
        ? "No posted commissions are on file yet, so there is nothing payable to this person."
        : "No posted commissions match this paid month. A $0 payable statement was not created.",
      showPayableTotals: false,
    };
  }
  return {
    kind: "missing_payouts" as const,
    emptyMessage: input.unallocatedCount > 0
      ? `${input.personName} has no stored payout rows for this period. ${input.unallocatedCount} posted commission${input.unallocatedCount === 1 ? "" : "s"} on assigned groups settled without a complete allocation. Confirm compensation before treating this as payable.`
      : `${input.personName} has no stored payout snapshots for this period. Posted commissions exist, but this person is not a payout recipient on those rows. Missing snapshots are not invented as $0 pay.`,
    showPayableTotals: false,
  };
}
