import { compensationExceptionWarning } from "./compensationExceptions";
import type { IndividualReportRow } from "./reports";

export type UnallocatedPostedCommission = {
  commissionId: number;
  groupId: number;
  groupName: string;
  lineOfBusinessId: number;
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
  assignedGroupIds?: number[];
  postedCommissions: Array<{
    id: number;
    groupId: number;
    groupName: string;
    lineOfBusinessId: number;
    lineOfBusinessName: string;
    paidMonth: string;
    grossCommissionCents: number;
    isEligibleFallback: boolean;
  }>;
}): RecipientPayableReadiness {
  const unallocated = input.postedCommissions
    .filter((row) => row.isEligibleFallback)
    .map((row) => ({
      commissionId: row.id,
      groupId: row.groupId,
      groupName: row.groupName,
      lineOfBusinessId: row.lineOfBusinessId,
      lineOfBusinessName: row.lineOfBusinessName,
      paidMonth: row.paidMonth,
      grossCommissionCents: row.grossCommissionCents,
    }));
  return {
    payableReady: unallocated.length === 0,
    unallocated,
    message: compensationExceptionWarning(unallocated.length),
  };
}

export function recipientStatementDisclaimer() {
  return "This statement shows current calculated earnings from posted commissions and the compensation in effect for each commission's Paid Month. Generating it does not mean the recipient has been paid.";
}

export function sourceCommissionIds(rows: Array<Pick<IndividualReportRow, "commissionId">>) {
  return [...new Set(rows.flatMap((row) => row.commissionId == null ? [] : [row.commissionId]))].sort((left, right) => left - right);
}

export type RecipientReviewKind = "ready" | "legitimate_zero" | "review_required" | "unknown_person" | "no_commissions";

export function recipientReportReviewState(input: {
  personSelected: boolean;
  personName: string | null;
  payoutRowCount?: number;
  calculatedRowCount?: number;
  payableCents: number;
  postedCommissionCount: number;
  matchingCommissionCount: number;
  unallocatedCount?: number;
  reviewRequiredCount?: number;
  readinessKind?: RecipientReviewKind | "calculated";
  showTotals?: boolean;
}) {
  if (!input.personSelected || !input.personName) {
    return {
      kind: "unknown_person" as const,
      emptyMessage: "Choose an Agent or Account Manager. Current earnings use that person's calculated recipient results, not a generic Recipient label.",
      showPayableTotals: false,
    };
  }
  if (input.reviewRequiredCount && input.reviewRequiredCount > 0) {
    return {
      kind: "review_required" as const,
      emptyMessage: null,
      showPayableTotals: true,
    };
  }
  if (input.readinessKind === "review_required") {
    return {
      kind: "review_required" as const,
      emptyMessage: null,
      showPayableTotals: true,
    };
  }
  if (input.readinessKind === "legitimate_zero" || input.showTotals && (input.calculatedRowCount ?? input.payoutRowCount ?? 0) === 0 && input.matchingCommissionCount > 0) {
    return {
      kind: "legitimate_zero" as const,
      emptyMessage: null,
      showPayableTotals: true,
    };
  }
  const rowCount = input.calculatedRowCount ?? input.payoutRowCount ?? 0;
  if (rowCount > 0 && input.payableCents === 0) {
    return {
      kind: "legitimate_zero" as const,
      emptyMessage: null,
      showPayableTotals: true,
    };
  }
  if (rowCount > 0 || input.readinessKind === "ready" || input.readinessKind === "calculated") {
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
    kind: "legitimate_zero" as const,
    emptyMessage: null,
    showPayableTotals: true,
  };
}
