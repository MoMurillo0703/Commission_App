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
  id?: number | null;
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

export type PaidMonthTeamMembershipBind = {
  teamId: number;
  membershipId: number;
  personKind: string;
  personId: number;
  shareBps: number;
  effectiveStart: string;
  effectiveEnd: string | null;
  status: string;
};

export type PaidMonthAllocationBind = {
  id: number;
  groupId: number;
  lineOfBusinessId: number;
  effectiveStart: string;
  effectiveEnd: string | null;
  status: string;
  entries: Array<{
    id: number;
    recipientType: string;
    personKind: string | null;
    personId: number | null;
    teamId: number | null;
    compensationBps: number;
  }>;
};

export type PaidMonthCommissionBind = {
  id: number;
  groupId: number;
  carrierId: number;
  lineOfBusinessId: number;
  grossCommissionCents: number;
  statementMonth: string;
  premiumMonth: string | null;
  sourceGroupLabel: string | null;
  sourceLobLabel: string | null;
  sourcePeriodLabel: string | null;
  sourceReference: string | null;
  sourceRowKey: string | null;
  importStatementId: number | null;
  corrected: boolean;
};

export function allocationTermsFingerprint(allocation: AllocationCandidate | PaidMonthAllocationBind | null) {
  if (!allocation) return "none";
  return stableJson({
    id: "id" in allocation ? allocation.id : null,
    groupId: allocation.groupId,
    lineOfBusinessId: allocation.lineOfBusinessId,
    effectiveStart: allocation.effectiveStart,
    effectiveEnd: allocation.effectiveEnd,
    status: allocation.status,
    entries: [...allocation.entries]
      .map((entry) => ({
        id: "id" in entry ? entry.id : null,
        recipientType: entry.recipientType,
        personKind: entry.personKind ?? null,
        personId: entry.personId ?? null,
        teamId: entry.teamId ?? null,
        compensationBps: entry.compensationBps,
      }))
      .sort((left, right) => (
        (left.id ?? 0) - (right.id ?? 0)
        || left.recipientType.localeCompare(right.recipientType)
        || (left.personKind ?? "").localeCompare(right.personKind ?? "")
        || (left.personId ?? 0) - (right.personId ?? 0)
        || (left.teamId ?? 0) - (right.teamId ?? 0)
        || left.compensationBps - right.compensationBps
      )),
  });
}

export function teamMembershipFingerprint(members: PaidMonthTeamMembershipBind[]) {
  return stableJson(
    [...members]
      .map((member) => ({
        teamId: member.teamId,
        membershipId: member.membershipId,
        personKind: member.personKind,
        personId: member.personId,
        shareBps: member.shareBps,
        effectiveStart: member.effectiveStart,
        effectiveEnd: member.effectiveEnd,
        status: member.status,
      }))
      .sort((left, right) => (
        left.teamId - right.teamId
        || left.personKind.localeCompare(right.personKind)
        || left.personId - right.personId
        || left.shareBps - right.shareBps
        || left.effectiveStart.localeCompare(right.effectiveStart)
      )),
  );
}

export function isImplicitAgencyPayouts(payouts: PaidMonthPayoutLike[]) {
  return payouts.length > 0
    && payouts.every((payout) => payout.allocationId == null)
    && payouts.every((payout) => payout.recipientType === "agency");
}

export function effectiveTeamMembershipsChanged(
  currentMembers: PaidMonthTeamMembershipBind[],
  proposedMembers: PaidMonthTeamMembershipBind[],
) {
  return teamMembershipFingerprint(currentMembers) !== teamMembershipFingerprint(proposedMembers);
}

export function classifyPaidMonthImpact(input: {
  payouts: PaidMonthPayoutLike[];
  corrected: boolean;
  oldAllocation: AllocationCandidate | PaidMonthAllocationBind | null;
  newAllocation: AllocationCandidate | PaidMonthAllocationBind | null;
  currentTeamMemberships?: PaidMonthTeamMembershipBind[];
  proposedTeamMemberships?: PaidMonthTeamMembershipBind[];
}): PaidMonthImpactClass {
  if (input.payouts.length === 0 && !input.corrected) return "unsettled";
  if (!input.newAllocation) {
    if (!input.oldAllocation && isImplicitAgencyPayouts(input.payouts)) return "equivalent_terms";
    return "no_allocation";
  }
  const allocationEquivalent = allocationTermsFingerprint(input.oldAllocation) === allocationTermsFingerprint(input.newAllocation);
  const teamsChanged = effectiveTeamMembershipsChanged(
    input.currentTeamMemberships ?? [],
    input.proposedTeamMemberships ?? [],
  );
  if (allocationEquivalent && !teamsChanged) return "equivalent_terms";
  if (!input.oldAllocation && isImplicitAgencyPayouts(input.payouts) && !allocationEquivalent) {
    return "different_terms";
  }
  if (allocationEquivalent && teamsChanged) return "different_terms";
  return "different_terms";
}

export function paidMonthImpactAllowsConfirm(impactClass: PaidMonthImpactClass) {
  return impactClass === "unsettled" || impactClass === "equivalent_terms";
}

export function paidMonthBoundState(input: {
  statementId: number;
  currentPaidMonth: string;
  newPaidMonth: string;
  commissions: PaidMonthCommissionBind[];
  payouts: Array<PaidMonthPayoutLike & { commissionId: number }>;
  allocations: PaidMonthAllocationBind[];
  currentTeamMemberships: PaidMonthTeamMembershipBind[];
  proposedTeamMemberships: PaidMonthTeamMembershipBind[];
}) {
  return {
    statement: {
      statementId: input.statementId,
      currentPaidMonth: input.currentPaidMonth,
      newPaidMonth: input.newPaidMonth,
    },
    commissions: [...input.commissions].sort((left, right) => left.id - right.id),
    payouts: [...input.payouts].sort((left, right) => (
      left.commissionId - right.commissionId
      || (left.id ?? 0) - (right.id ?? 0)
    )),
    allocations: [...input.allocations].sort((left, right) => left.id - right.id),
    currentTeamMemberships: input.currentTeamMemberships,
    proposedTeamMemberships: input.proposedTeamMemberships,
  };
}

export function paidMonthPreviewToken(state: ReturnType<typeof paidMonthBoundState>) {
  return fingerprintBuffer(new TextEncoder().encode(stableJson(state)));
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

export function invariantStateAfterPaidMonthMove(state: ReturnType<typeof paidMonthBoundState>) {
  return stableJson({
    commissions: state.commissions.map((row) => ({
      id: row.id,
      groupId: row.groupId,
      carrierId: row.carrierId,
      lineOfBusinessId: row.lineOfBusinessId,
      grossCommissionCents: row.grossCommissionCents,
      premiumMonth: row.premiumMonth,
      sourceGroupLabel: row.sourceGroupLabel,
      sourceLobLabel: row.sourceLobLabel,
      sourcePeriodLabel: row.sourcePeriodLabel,
      sourceReference: row.sourceReference,
      sourceRowKey: row.sourceRowKey,
      importStatementId: row.importStatementId,
      corrected: row.corrected,
    })),
    payouts: state.payouts,
    allocations: state.allocations,
    membershipsByMonth: {
      [state.statement.currentPaidMonth]: state.currentTeamMemberships,
      [state.statement.newPaidMonth]: state.proposedTeamMemberships,
    },
  });
}
