import {
  allocationNeedsReview,
} from "./compensationQueue";
import {
  resolveCompensationAllocation,
  type AllocationCandidate,
  type PersonKind,
  type SettledAllocation,
  type SettledPayout,
} from "./allocations";
import { paidMonthInRange } from "./dates";
import { formatAllocationPercent } from "./recipientStatement";
import type { CorrectionSourceClass } from "./compensationFallback";
import { LEGACY_NO_PAYOUT_LABEL } from "./compensationFallback";

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

export type CorrectionOriginalPayoutState = {
  count: number;
  rows: Array<{
    id: number | null;
    recipientType: string;
    personKind: string | null;
    personId: number | null;
    allocationId: number | null;
    allocationBps: number;
    compensationCents: number;
  }>;
};

export type CorrectionOriginalBoundState = {
  sourceClass: CorrectionSourceClass;
  commissionId: number;
  paidMonth: string;
  grossCommissionCents: number;
  agentCompensationCents: number;
  agencyNetCents: number;
  payoutCount: number;
  payouts: CorrectionOriginalPayoutState;
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
    sourceClass: CorrectionSourceClass | null;
    sourceLabel: string;
    grossCommissionCents: number;
    agentCompensationCents: number;
    agencyCents: number;
    agencyNetCents: number;
    payoutCount: number;
    payoutSnapshotLabel: string;
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

export function originalPayoutState(payouts: Array<{
  id?: number;
  recipientType: string;
  personKind?: string | null;
  personId?: number | null;
  allocationId?: number | null;
  allocationBps: number;
  compensationCents: number;
}>): CorrectionOriginalPayoutState {
  return {
    count: payouts.length,
    rows: [...payouts].map((payout) => ({
      id: payout.id ?? null,
      recipientType: payout.recipientType,
      personKind: payout.personKind ?? null,
      personId: payout.personId ?? null,
      allocationId: payout.allocationId ?? null,
      allocationBps: payout.allocationBps,
      compensationCents: payout.compensationCents,
    })).sort((left, right) => (
      (left.id ?? 0) - (right.id ?? 0)
      || left.recipientType.localeCompare(right.recipientType)
    )),
  };
}

export function bindOriginalCorrectionState(input: {
  sourceClass: CorrectionSourceClass;
  commissionId: number;
  paidMonth: string;
  grossCommissionCents: number;
  agentCompensationCents: number;
  agencyNetCents: number;
  payouts: Parameters<typeof originalPayoutState>[0];
}): CorrectionOriginalBoundState {
  const payouts = originalPayoutState(input.payouts);
  return {
    sourceClass: input.sourceClass,
    commissionId: input.commissionId,
    paidMonth: input.paidMonth,
    grossCommissionCents: input.grossCommissionCents,
    agentCompensationCents: input.agentCompensationCents,
    agencyNetCents: input.agencyNetCents,
    payoutCount: payouts.count,
    payouts,
  };
}

export function originalStatesMatch(left: CorrectionOriginalBoundState, right: CorrectionOriginalBoundState) {
  return stableJson(left) === stableJson(right);
}

export function payoutSnapshotLabel(payoutCount: number) {
  if (payoutCount === 0) return "None";
  return `${payoutCount} payout row${payoutCount === 1 ? "" : "s"}`;
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
  originalAgentCompensationCents?: number;
  originalPayoutCount?: number;
  originalLabel?: string;
  sourceClass?: CorrectionSourceClass | null;
  proposed: CorrectionPreviewItem["proposed"];
  blockedReason: string | null;
}): CorrectionPreviewItem {
  const sourceClass = input.sourceClass ?? null;
  const sourceLabel = input.originalLabel
    ?? (sourceClass === "legacy_no_payout_snapshot" ? LEGACY_NO_PAYOUT_LABEL : "Agency 100%");
  return {
    commissionId: input.commissionId,
    paidMonth: input.paidMonth,
    groupName: input.groupName,
    carrierName: input.carrierName,
    lineOfBusinessName: input.lineOfBusinessName,
    grossCommissionCents: input.grossCommissionCents,
    original: {
      label: sourceLabel,
      sourceClass,
      sourceLabel,
      grossCommissionCents: input.grossCommissionCents,
      agentCompensationCents: input.originalAgentCompensationCents ?? 0,
      agencyCents: input.originalAgencyCents,
      agencyNetCents: input.originalAgencyNetCents,
      payoutCount: input.originalPayoutCount ?? 0,
      payoutSnapshotLabel: payoutSnapshotLabel(input.originalPayoutCount ?? 0),
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

export type CorrectionAuthorizedCommission = {
  commissionId: number;
  paidMonth: string;
  original: CorrectionOriginalBoundState;
  allocation: {
    id: number;
    groupId: number;
    lineOfBusinessId: number;
    effectiveStart: string;
    effectiveEnd: string | null;
    status: string;
    entries: Array<{
      recipientType: string;
      personKind: string | null;
      personId: number | null;
      teamId: number | null;
      compensationBps: number;
    }>;
  };
  teams: Array<{
    teamId: number;
    members: Array<{
      personKind: string;
      personId: number;
      shareBps: number;
      effectiveStart: string;
      effectiveEnd: string | null;
      status: string;
    }>;
  }>;
  proposedPayouts: Array<{
    recipientType: string;
    personKind: string | null;
    personId: number | null;
    teamId: number | null;
    allocationBps: number;
    teamInternalBps: number | null;
    compensationCents: number;
  }>;
  proposedAgentCompensationCents: number;
  proposedAgencyNetCents: number;
};

export type CorrectionAuthorizedTerms = {
  commissions: CorrectionAuthorizedCommission[];
};

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

export function stalePreviewMessage() {
  return "The authorized preview no longer matches the original commission state, allocation, or team terms. Preview again.";
}

export function historicalAllocationIncludesRecipient(
  allocation: AllocationCandidate | null,
  teams: Array<{
    id: number;
    members: Array<{
      personKind: PersonKind;
      personId: number;
      shareBps: number;
      effectiveStart?: string;
      effectiveEnd?: string | null;
      status?: string;
    }>;
  }>,
  paidMonth: string,
  person: { personKind: PersonKind; personId: number },
) {
  if (!allocation) return false;
  if (allocation.entries.some((entry) => (
    entry.recipientType === "person"
    && entry.personKind === person.personKind
    && entry.personId === person.personId
  ))) {
    return true;
  }
  return allocation.entries.some((entry) => {
    if (entry.recipientType !== "team" || entry.teamId == null) return false;
    const team = teams.find((item) => item.id === entry.teamId);
    return Boolean(team?.members.some((member) => (
      member.personKind === person.personKind
      && member.personId === person.personId
      && (member.status ?? "active") === "active"
      && (member.effectiveStart == null || paidMonthInRange(paidMonth, member.effectiveStart, member.effectiveEnd ?? null))
    )));
  });
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
