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
import { recipientCompensationMethod } from "./reportPresentation";
import { individualRecipientTypeLabel } from "./reportWorkspace";
import type { IndividualReportRow, TeamReportRow } from "./reports";

export const EARNINGS_REVIEW_REQUIRED = "REVIEW REQUIRED";

export type EarningsReviewReason =
  | "allocation does not total 100%"
  | "Team has invalid effective membership"
  | "conflicting effective allocation periods";

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
    allocation.groupId === query.groupId
    && allocation.lineOfBusinessId === query.lineOfBusinessId
    && paidMonthInRange(query.paidMonth, allocation.effectiveStart, allocation.effectiveEnd)
  )).sort((left, right) => right.effectiveStart.localeCompare(left.effectiveStart) || left.id - right.id);
}

export function resolveEarningsAllocation(
  allocations: AllocationCandidate[],
  query: { groupId: number; lineOfBusinessId: number; paidMonth: string },
): {
  allocation: AllocationCandidate | null;
  defaultAgency: boolean;
  reviewReason: EarningsReviewReason | null;
} {
  const covering = coveringAllocationsForPaidMonth(allocations, query);
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
}): {
  settled: SettledAllocation | null;
  allocationId: number | null;
  defaultAgency: boolean;
  reviewReason: EarningsReviewReason | null;
} {
  const resolved = resolveEarningsAllocation(input.allocations, {
    groupId: input.commission.groupId,
    lineOfBusinessId: input.commission.lineOfBusinessId,
    paidMonth: input.commission.paidMonth,
  });
  if (resolved.reviewReason) {
    return { settled: null, allocationId: resolved.allocation?.id ?? null, defaultAgency: false, reviewReason: resolved.reviewReason };
  }
  if (resolved.defaultAgency || !resolved.allocation) {
    return {
      settled: implicitAgencyAllocation(input.commission.grossCommissionCents, input.names.agencyName ?? "Murillo Insurance"),
      allocationId: null,
      defaultAgency: true,
      reviewReason: null,
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

export function projectIndividualEarnings(input: {
  commissions: EarningsCommission[];
  allocations: AllocationCandidate[];
  teams: EarningsTeam[];
  names: { agencyName?: string; personName: (kind: PersonKind, id: number) => string };
  personKind?: PersonKind | null;
  personId?: number | null;
  teamId?: number | null;
}): IndividualReportRow[] {
  const rows: IndividualReportRow[] = [];
  for (const commission of input.commissions) {
    const result = settleCurrentCommissionEarnings({
      commission,
      allocations: input.allocations,
      teams: input.teams,
      names: input.names,
    });
    if (result.reviewReason) {
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
    const leaves = (result.settled?.payouts ?? []).filter((payout) => payout.recipientType === "person" || payout.recipientType === "team_member");
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
  return rows;
}

export function projectTeamEarnings(input: {
  commissions: EarningsCommission[];
  allocations: AllocationCandidate[];
  teams: EarningsTeam[];
  names: { agencyName?: string; personName: (kind: PersonKind, id: number) => string };
  teamId?: number | null;
}): TeamReportRow[] {
  const rows: TeamReportRow[] = [];
  for (const commission of input.commissions) {
    const result = settleCurrentCommissionEarnings({
      commission,
      allocations: input.allocations,
      teams: input.teams,
      names: input.names,
    });
    if (result.reviewReason) {
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
