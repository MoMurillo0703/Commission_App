import {
  allocationNeedsReview,
} from "./compensationQueue";
import {
  resolveCompensationAllocation,
  type AllocationCandidate,
  type SettledAllocation,
  type SettledPayout,
} from "./allocations";
import { formatAllocationPercent } from "./recipientStatement";

export type HistoricalAllocationState = "covers" | "newer_only" | "missing";

export function historicalAllocationForPaidMonth(
  allocations: AllocationCandidate[],
  query: { groupId: number; lineOfBusinessId: number; paidMonth: string },
) {
  const complete = allocations.filter((allocation) => (
    allocation.groupId === query.groupId
    && allocation.lineOfBusinessId === query.lineOfBusinessId
    && !allocationNeedsReview(allocation)
  ));
  return resolveCompensationAllocation(complete, query);
}

export function historicalAllocationState(
  allocations: AllocationCandidate[],
  query: { groupId: number; lineOfBusinessId: number; paidMonth: string },
): HistoricalAllocationState {
  if (historicalAllocationForPaidMonth(allocations, query)) return "covers";
  const newerComplete = allocations.some((allocation) => (
    allocation.groupId === query.groupId
    && allocation.lineOfBusinessId === query.lineOfBusinessId
    && allocation.effectiveStart > query.paidMonth
    && !allocationNeedsReview(allocation)
  ));
  return newerComplete ? "newer_only" : "missing";
}

export type CorrectionPreviewRecipient = {
  recipientType: SettledPayout["recipientType"];
  name: string;
  splitBps: number;
  splitPercent: string;
  compensationCents: number;
};

export type CorrectionPreviewItem = {
  commissionId: number;
  paidMonth: string;
  groupName: string;
  carrierName: string;
  lineOfBusinessName: string;
  grossCommissionCents: number;
  original: {
    label: string;
    agencyCents: number;
    agencyNetCents: number;
  };
  proposed: {
    allocationId: number;
    allocationLabel: string;
    recipients: CorrectionPreviewRecipient[];
    agencyCents: number;
    agencyNetCents: number;
    recipientPayableCents: number;
  } | null;
  blockedReason: string | null;
};

export function proposedCorrectionSettlement(settled: SettledAllocation, allocation: AllocationCandidate) {
  const recipients = settled.payouts
    .filter((payout) => payout.recipientType !== "team")
    .map((payout) => ({
      recipientType: payout.recipientType,
      name: payout.personName ?? payout.teamName ?? (payout.recipientType === "agency" ? "Agency" : "Recipient"),
      splitBps: payout.allocationBps,
      splitPercent: formatAllocationPercent(payout.allocationBps),
      compensationCents: payout.compensationCents,
    }));
  const agencyCents = settled.payouts
    .filter((payout) => payout.recipientType === "agency")
    .reduce((sum, payout) => sum + payout.compensationCents, 0);
  return {
    allocationId: allocation.id,
    allocationLabel: `${allocation.effectiveStart} – ${allocation.effectiveEnd ?? "Present"}`,
    recipients,
    agencyCents,
    agencyNetCents: settled.agencyNetCents,
    recipientPayableCents: settled.compensationDistributedCents,
  };
}

export function correctionPreviewItem(input: {
  commissionId: number;
  paidMonth: string;
  groupName: string;
  carrierName: string;
  lineOfBusinessName: string;
  grossCommissionCents: number;
  originalAgencyCents: number;
  originalAgencyNetCents: number;
  proposed: CorrectionPreviewItem["proposed"];
  blockedReason: string | null;
}): CorrectionPreviewItem {
  return {
    commissionId: input.commissionId,
    paidMonth: input.paidMonth,
    groupName: input.groupName,
    carrierName: input.carrierName,
    lineOfBusinessName: input.lineOfBusinessName,
    grossCommissionCents: input.grossCommissionCents,
    original: {
      label: "Agency 100%",
      agencyCents: input.originalAgencyCents,
      agencyNetCents: input.originalAgencyNetCents,
    },
    proposed: input.proposed,
    blockedReason: input.blockedReason,
  };
}

export function correctionPreviewTotals(items: CorrectionPreviewItem[]) {
  return {
    grossCents: items.reduce((sum, item) => sum + item.grossCommissionCents, 0),
    originalAgencyCents: items.reduce((sum, item) => sum + item.original.agencyCents, 0),
    proposedRecipientPayableCents: items.reduce((sum, item) => sum + (item.proposed?.recipientPayableCents ?? 0), 0),
    resultingAgencyCents: items.reduce((sum, item) => sum + (item.proposed?.agencyNetCents ?? item.original.agencyNetCents), 0),
  };
}

export function correctablePreviewIds(items: CorrectionPreviewItem[]) {
  return items.filter((item) => item.proposed && !item.blockedReason).map((item) => item.commissionId);
}

export function newerAllocationBlockedMessage() {
  return "Correction is blocked because only a newer allocation exists. Create an allocation that covers the original paid month.";
}

export function missingAllocationBlockedMessage() {
  return "Correction is blocked until a complete allocation covers the original paid month.";
}

export function payoutAuditSnapshot(payouts: Array<{
  id?: number;
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
}>) {
  return payouts.map((payout) => ({
    id: payout.id ?? null,
    recipientType: payout.recipientType,
    personKind: payout.personKind ?? null,
    personId: payout.personId ?? null,
    personName: payout.personName ?? null,
    teamId: payout.teamId ?? null,
    teamName: payout.teamName ?? null,
    parentPayoutId: payout.parentPayoutId ?? null,
    allocationId: payout.allocationId ?? null,
    allocationBps: payout.allocationBps,
    teamInternalBps: payout.teamInternalBps ?? null,
    compensationCents: payout.compensationCents,
  }));
}
