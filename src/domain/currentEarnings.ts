import {
  allocationTotals,
  implicitAgencyAllocation,
  settleAllocation,
  type AllocationCandidate,
  type PersonKind,
  type SettledAllocation,
  type TeamShare,
} from "./allocations";
import { paidMonthInRange } from "./dates";
import { coveringAllocationsForCanonicalPair, type CanonicalLine } from "./canonicalLob";
import { allocationHasOwnerAndAgencyDuplicate } from "./personCompensationModel";
import { AGENCY_OWNER_DISPLAY_NAME, type PersonIdentity } from "./agencyOwner";
import { recipientCompensationMethod } from "./reportPresentation";
import { individualRecipientTypeLabel } from "./reportWorkspace";
import type { IndividualReportRow, TeamReportRow } from "./reports";

export const EARNINGS_REVIEW_REQUIRED = "REVIEW REQUIRED";

export type EarningsReviewReason =
  | "allocation does not total 100%"
  | "Team has invalid effective membership"
  | "conflicting effective allocation periods"
  | "Agency owner is not configured"
  | "Mo is named twice as person and Agency";

export type EarningsCommission = {
  id: number;
  paidMonth: string;
  groupId: number;
  groupName: string;
  carrierId: number;
  carrierName: string;
  lineOfBusinessId: number;
  lineOfBusinessName: string;
  grossCommissionCents: number;
  premiumCents?: number | null;
  premiumMonth?: string | null;
  sourcePeriodLabel?: string | null;
  importStatementId?: number | null;
};

export type EarningsTeam = {
  id: number;
  name: string;
  members: Array<{
    personKind: PersonKind;
    personId: number;
    name: string;
    shareBps: number;
    effectiveStart: string;
    effectiveEnd: string | null;
    status: string;
  }>;
};

export function coveringAllocationsForPaidMonth(
  allocations: AllocationCandidate[],
  query: { groupId: number; lineOfBusinessId: number; paidMonth: string },
) {
  return allocations.filter((allocation) => (
    allocation.status === "active"
    && allocation.groupId === query.groupId
    && allocation.lineOfBusinessId === query.lineOfBusinessId
    && paidMonthInRange(query.paidMonth, allocation.effectiveStart, allocation.effectiveEnd)
  )).sort((left, right) => right.effectiveStart.localeCompare(left.effectiveStart) || left.id - right.id);
}

export type CommissionEarningsKind = "calculated" | "agency_default" | "review_required";

export type CommissionEarningsOutcome = {
  commissionId: number;
  paidMonth: string;
  groupId: number;
  groupName: string;
  lineOfBusinessId: number;
  lineOfBusinessName: string;
  grossCommissionCents: number;
  kind: CommissionEarningsKind;
  defaultAgency: boolean;
  reviewReason: EarningsReviewReason | null;
  allocationId: number | null;
};

export type CurrentEarningsReadinessKind = "calculated" | "legitimate_zero" | "review_required" | "no_commissions";

export type CurrentEarningsReadiness = {
  kind: CurrentEarningsReadinessKind;
  payableReady: boolean;
  showTotals: boolean;
  reviewRequired: boolean;
  message: string | null;
  reviewCommissionIds: number[];
};

export function currentEarningsReadiness(input: {
  matchingCommissionCount: number;
  outcomes: CommissionEarningsOutcome[];
  recipientRowCount: number;
}): CurrentEarningsReadiness {
  const review = input.outcomes.filter((outcome) => outcome.kind === "review_required");
  if (review.length > 0) {
    return {
      kind: "review_required",
      payableReady: false,
      showTotals: true,
      reviewRequired: true,
      message: "REVIEW REQUIRED — this report contains commissions that cannot be calculated from the applicable allocation or Team membership. Calculated totals are not fully ready.",
      reviewCommissionIds: review.map((outcome) => outcome.commissionId),
    };
  }
  if (input.matchingCommissionCount === 0) {
    return {
      kind: "no_commissions",
      payableReady: true,
      showTotals: false,
      reviewRequired: false,
      message: null,
      reviewCommissionIds: [],
    };
  }
  if (input.recipientRowCount === 0) {
    return {
      kind: "legitimate_zero",
      payableReady: true,
      showTotals: true,
      reviewRequired: false,
      message: null,
      reviewCommissionIds: [],
    };
  }
  return {
    kind: "calculated",
    payableReady: true,
    showTotals: true,
    reviewRequired: false,
    message: null,
    reviewCommissionIds: [],
  };
}

export function resolveEarningsAllocation(
  allocations: AllocationCandidate[],
  query: { groupId: number; lineOfBusinessId: number; paidMonth: string },
  lines?: CanonicalLine[],
): {
  allocation: AllocationCandidate | null;
  defaultAgency: boolean;
  reviewReason: EarningsReviewReason | null;
} {
  const covering = lines
    ? coveringAllocationsForCanonicalPair(allocations, query, lines, paidMonthInRange)
    : coveringAllocationsForPaidMonth(allocations, query);
  if (covering.length === 0) {
    return { allocation: null, defaultAgency: true, reviewReason: null };
  }
  if (covering.length > 1) {
    return { allocation: null, defaultAgency: false, reviewReason: "conflicting effective allocation periods" };
  }
  const allocation = covering[0]!;
  if (!allocationTotals(allocation.entries).complete) {
    return { allocation, defaultAgency: false, reviewReason: "allocation does not total 100%" };
  }
  return { allocation, defaultAgency: false, reviewReason: null };
}

export function teamSharesForPaidMonth(teams: EarningsTeam[], paidMonth: string): Map<number, TeamShare> {
  return new Map(teams.map((team) => [team.id, {
    id: team.id,
    name: team.name,
    members: team.members
      .filter((member) => member.status === "active" && paidMonthInRange(paidMonth, member.effectiveStart, member.effectiveEnd))
      .map((member) => ({
        personKind: member.personKind,
        personId: member.personId,
        name: member.name,
        shareBps: member.shareBps,
      })),
  }]));
}

export function settleCurrentCommissionEarnings(input: {
  commission: EarningsCommission;
  allocations: AllocationCandidate[];
  teams: EarningsTeam[];
  names: { agencyName?: string; personName: (kind: PersonKind, id: number) => string };
  agencyOwner?: PersonIdentity | null;
  ownerForPaidMonth?: (paidMonth: string) => PersonIdentity | null;
  lines?: CanonicalLine[];
}): {
  settled: SettledAllocation | null;
  allocationId: number | null;
  defaultAgency: boolean;
  reviewReason: EarningsReviewReason | null;
} {
  const owner = input.ownerForPaidMonth
    ? input.ownerForPaidMonth(input.commission.paidMonth)
    : input.agencyOwner;
  const resolved = resolveEarningsAllocation(input.allocations, {
    groupId: input.commission.groupId,
    lineOfBusinessId: input.commission.lineOfBusinessId,
    paidMonth: input.commission.paidMonth,
  }, input.lines);
  if (resolved.reviewReason) {
    return { settled: null, allocationId: resolved.allocation?.id ?? null, defaultAgency: false, reviewReason: resolved.reviewReason };
  }
  if (resolved.defaultAgency || !resolved.allocation) {
    if (owner == null && (input.ownerForPaidMonth || input.agencyOwner !== undefined)) {
      return {
        settled: null,
        allocationId: null,
        defaultAgency: false,
        reviewReason: "Agency owner is not configured",
      };
    }
    if (owner == null) {
      return {
        settled: implicitAgencyAllocation(input.commission.grossCommissionCents, input.names.agencyName ?? "Murillo Insurance"),
        allocationId: null,
        defaultAgency: true,
        reviewReason: null,
      };
    }
    return {
      settled: implicitAgencyAllocation(
        input.commission.grossCommissionCents,
        AGENCY_OWNER_DISPLAY_NAME,
      ),
      allocationId: null,
      defaultAgency: true,
      reviewReason: null,
    };
  }
  const hasAgency = resolved.allocation.entries.some((entry) => entry.recipientType === "agency");
  if (hasAgency && owner == null && (input.ownerForPaidMonth || input.agencyOwner !== undefined)) {
    return {
      settled: null,
      allocationId: resolved.allocation.id,
      defaultAgency: false,
      reviewReason: "Agency owner is not configured",
    };
  }
  if (allocationHasOwnerAndAgencyDuplicate(
    resolved.allocation.entries,
    owner ?? null,
    input.teams,
    input.commission.paidMonth,
  )) {
    return {
      settled: null,
      allocationId: resolved.allocation.id,
      defaultAgency: false,
      reviewReason: "Mo is named twice as person and Agency",
    };
  }
  try {
    const settled = settleAllocation(
      input.commission.grossCommissionCents,
      resolved.allocation.entries,
      teamSharesForPaidMonth(input.teams, input.commission.paidMonth),
      input.names,
    );
    return { settled, allocationId: resolved.allocation.id, defaultAgency: false, reviewReason: null };
  } catch {
    return {
      settled: null,
      allocationId: resolved.allocation.id,
      defaultAgency: false,
      reviewReason: "Team has invalid effective membership",
    };
  }
}

export function individualPeoplePayouts(
  payouts: SettledAllocation["payouts"],
  owner?: PersonIdentity | null,
) {
  const people = payouts.filter((payout) => payout.recipientType === "person" || payout.recipientType === "team_member");
  if (!owner) return people;
  return [
    ...people,
    ...payouts.filter((payout) => payout.recipientType === "agency").map((payout) => ({
      ...payout,
      recipientType: "person" as const,
      personKind: owner.personKind,
      personId: owner.personId,
      personName: AGENCY_OWNER_DISPLAY_NAME,
    })),
  ];
}

export function evaluateIndividualEarnings(input: {
  commissions: EarningsCommission[];
  allocations: AllocationCandidate[];
  teams: EarningsTeam[];
  names: { agencyName?: string; personName: (kind: PersonKind, id: number) => string };
  personKind?: PersonKind | null;
  personId?: number | null;
  teamId?: number | null;
  agencyOwner?: PersonIdentity | null;
  ownerForPaidMonth?: (paidMonth: string) => PersonIdentity | null;
  lines?: CanonicalLine[];
}): { rows: IndividualReportRow[]; outcomes: CommissionEarningsOutcome[] } {
  const rows: IndividualReportRow[] = [];
  const outcomes: CommissionEarningsOutcome[] = [];
  for (const commission of input.commissions) {
    const owner = input.ownerForPaidMonth
      ? input.ownerForPaidMonth(commission.paidMonth)
      : input.agencyOwner;
    const result = settleCurrentCommissionEarnings({
      commission,
      allocations: input.allocations,
      teams: input.teams,
      names: input.names,
      agencyOwner: owner,
      ownerForPaidMonth: input.ownerForPaidMonth,
      lines: input.lines,
    });
    const outcomeBase = {
      commissionId: commission.id,
      paidMonth: commission.paidMonth,
      groupId: commission.groupId,
      groupName: commission.groupName,
      lineOfBusinessId: commission.lineOfBusinessId,
      lineOfBusinessName: commission.lineOfBusinessName,
      grossCommissionCents: commission.grossCommissionCents,
      defaultAgency: result.defaultAgency,
      reviewReason: result.reviewReason,
      allocationId: result.allocationId,
    };
    if (result.reviewReason) {
      outcomes.push({ ...outcomeBase, kind: "review_required" });
      rows.push({
        paidMonth: commission.paidMonth,
        groupId: commission.groupId,
        groupName: commission.groupName,
        carrierId: commission.carrierId,
        carrierName: commission.carrierName,
        lineOfBusinessId: commission.lineOfBusinessId,
        lineOfBusinessName: commission.lineOfBusinessName,
        recipientName: EARNINGS_REVIEW_REQUIRED,
        recipientType: EARNINGS_REVIEW_REQUIRED,
        recipientMethod: undefined,
        personKind: input.personKind ?? null,
        personId: input.personId ?? null,
        teamName: null,
        grossCommissionCents: commission.grossCommissionCents,
        allocationBps: 0,
        teamInternalBps: null,
        compensationCents: 0,
        commissionId: commission.id,
        allocationId: result.allocationId,
        premiumCents: commission.premiumCents,
        premiumMonth: commission.premiumMonth,
        sourcePeriodLabel: commission.sourcePeriodLabel,
        importStatementId: commission.importStatementId,
        reviewRequired: true,
        reviewReason: result.reviewReason,
      });
      continue;
    }
    outcomes.push({
      ...outcomeBase,
      kind: result.defaultAgency ? "agency_default" : "calculated",
    });
    const leaves = individualPeoplePayouts(result.settled?.payouts ?? [], owner);
    for (const payout of leaves) {
      const method = recipientCompensationMethod(payout.recipientType);
      if (!method) continue;
      if (input.personKind && payout.personKind !== input.personKind) continue;
      if (input.personId && payout.personId !== input.personId) continue;
      if (input.teamId && payout.teamId !== input.teamId) continue;
      rows.push({
        paidMonth: commission.paidMonth,
        groupId: commission.groupId,
        groupName: commission.groupName,
        carrierId: commission.carrierId,
        carrierName: commission.carrierName,
        lineOfBusinessId: commission.lineOfBusinessId,
        lineOfBusinessName: commission.lineOfBusinessName,
        recipientName: payout.personName ?? "Person",
        recipientType: individualRecipientTypeLabel({ personKind: payout.personKind, teamName: payout.teamName }),
        recipientMethod: method,
        personKind: payout.personKind,
        personId: payout.personId,
        teamName: payout.teamName,
        grossCommissionCents: commission.grossCommissionCents,
        allocationBps: payout.allocationBps,
        teamInternalBps: payout.teamInternalBps,
        compensationCents: payout.compensationCents,
        commissionId: commission.id,
        allocationId: result.allocationId,
        premiumCents: commission.premiumCents,
        premiumMonth: commission.premiumMonth,
        sourcePeriodLabel: commission.sourcePeriodLabel,
        importStatementId: commission.importStatementId,
        reviewRequired: false,
        reviewReason: null,
      });
    }
  }
  return { rows, outcomes };
}

export function projectIndividualEarnings(input: Parameters<typeof evaluateIndividualEarnings>[0]): IndividualReportRow[] {
  return evaluateIndividualEarnings(input).rows;
}

export function projectTeamEarnings(input: {
  commissions: EarningsCommission[];
  allocations: AllocationCandidate[];
  teams: EarningsTeam[];
  names: { agencyName?: string; personName: (kind: PersonKind, id: number) => string };
  teamId?: number | null;
  agencyOwner?: PersonIdentity | null;
  ownerForPaidMonth?: (paidMonth: string) => PersonIdentity | null;
  lines?: CanonicalLine[];
}): TeamReportRow[] {
  const rows: TeamReportRow[] = [];
  for (const commission of input.commissions) {
    const result = settleCurrentCommissionEarnings({
      commission,
      allocations: input.allocations,
      teams: input.teams,
      names: input.names,
      agencyOwner: input.agencyOwner,
      ownerForPaidMonth: input.ownerForPaidMonth,
      lines: input.lines,
    });
    if (result.reviewReason) {
      if (input.teamId) {
        const covering = input.lines
          ? coveringAllocationsForCanonicalPair(
            input.allocations,
            {
              groupId: commission.groupId,
              lineOfBusinessId: commission.lineOfBusinessId,
              paidMonth: commission.paidMonth,
            },
            input.lines,
            paidMonthInRange,
          )
          : coveringAllocationsForPaidMonth(input.allocations, {
            groupId: commission.groupId,
            lineOfBusinessId: commission.lineOfBusinessId,
            paidMonth: commission.paidMonth,
          });
        const involvesTeam = covering.some((allocation) => allocation.entries.some((entry) => (
          entry.recipientType === "team" && entry.teamId === input.teamId
        )));
        if (!involvesTeam) continue;
      }
      rows.push({
        snapshotKey: `${commission.id}:review`,
        paidMonth: commission.paidMonth,
        teamId: 0,
        teamName: EARNINGS_REVIEW_REQUIRED,
        groupId: commission.groupId,
        groupName: commission.groupName,
        lineOfBusinessId: commission.lineOfBusinessId,
        lineOfBusinessName: commission.lineOfBusinessName,
        grossCommissionCents: commission.grossCommissionCents,
        teamAllocationBps: 0,
        teamCompensationCents: 0,
        memberName: EARNINGS_REVIEW_REQUIRED,
        memberCompensationCents: 0,
        memberAllocationBps: 0,
        reviewRequired: true,
        reviewReason: result.reviewReason,
      });
      continue;
    }
    const payouts = result.settled?.payouts ?? [];
    const teamParents = payouts.filter((payout) => payout.recipientType === "team" && (!input.teamId || payout.teamId === input.teamId));
    for (const team of teamParents) {
      const members = payouts.filter((payout) => payout.recipientType === "team_member" && payout.parentKey === team.key);
      const snapshotKey = `${commission.id}:${team.teamId ?? 0}`;
      if (members.length === 0) {
        rows.push({
          snapshotKey,
          paidMonth: commission.paidMonth,
          teamId: team.teamId ?? 0,
          teamName: team.teamName ?? "Team",
          groupId: commission.groupId,
          groupName: commission.groupName,
          lineOfBusinessId: commission.lineOfBusinessId,
          lineOfBusinessName: commission.lineOfBusinessName,
          grossCommissionCents: commission.grossCommissionCents,
          teamAllocationBps: team.allocationBps,
          teamCompensationCents: team.compensationCents,
          memberName: "—",
          memberCompensationCents: 0,
          memberAllocationBps: 0,
        });
        continue;
      }
      for (const member of members) {
        rows.push({
          snapshotKey,
          paidMonth: commission.paidMonth,
          teamId: team.teamId ?? 0,
          teamName: team.teamName ?? "Team",
          groupId: commission.groupId,
          groupName: commission.groupName,
          lineOfBusinessId: commission.lineOfBusinessId,
          lineOfBusinessName: commission.lineOfBusinessName,
          grossCommissionCents: commission.grossCommissionCents,
          teamAllocationBps: team.allocationBps,
          teamCompensationCents: team.compensationCents,
          memberName: member.personName ?? "Member",
          memberCompensationCents: member.compensationCents,
          memberAllocationBps: member.allocationBps,
        });
      }
    }
  }
  return rows;
}
