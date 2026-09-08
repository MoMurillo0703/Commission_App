import { FULL_ALLOCATION_BPS } from "./allocations";
import { AGENCY_OWNER_LABEL, payableOwnerGapMessage, personKey, samePerson, type PersonIdentity } from "./agencyOwner";
import { paidMonthInRange } from "./dates";
import {
  isEligibleAgencyFallback,
  isLegacyNoPayoutSnapshot,
  NOT_PAYABLE_READY_MESSAGE,
} from "./compensationFallback";
import { monthInReportRange, normalizeReportFilters, type ReportFilters } from "./reports";

export type BusinessPayoutBucket =
  | "mo_direct"
  | "mo_team"
  | "agency_retained"
  | "inconsistent_agency"
  | "named_person"
  | "other_person"
  | "team_parent";

export type BusinessPayoutInput = {
  recipientType: string;
  personKind?: string | null;
  personId?: number | null;
  allocationId?: number | null;
  allocationBps?: number;
  compensationCents: number;
};

export type NamedBusinessPerson = PersonIdentity & { label: string };

export type BusinessCommissionInput = {
  id: number;
  paidMonth: string;
  groupId?: number;
  carrierId?: number;
  lineOfBusinessId?: number;
  groupName?: string;
  carrierName?: string;
  lineOfBusinessName?: string;
  grossCommissionCents: number;
  agentCompensationCents?: number;
  agencyNetCents?: number;
  hasPriorCorrection?: boolean;
  payouts: BusinessPayoutInput[];
};

export function payoutPerson(payout: BusinessPayoutInput): PersonIdentity | null {
  if ((payout.recipientType !== "person" && payout.recipientType !== "team_member") || payout.personId == null) {
    return null;
  }
  if (payout.personKind !== "agent" && payout.personKind !== "account_manager") return null;
  return { personKind: payout.personKind, personId: payout.personId };
}

export function classifyBusinessPayout(
  payout: BusinessPayoutInput,
  owner: PersonIdentity | null,
  namedPeople: NamedBusinessPerson[] = [],
): BusinessPayoutBucket {
  if (payout.recipientType === "team") return "team_parent";
  if (payout.recipientType === "agency") {
    return payout.allocationId == null ? "inconsistent_agency" : "agency_retained";
  }
  const person = payoutPerson(payout);
  if (!person) return "other_person";
  if (owner && samePerson(person, owner)) {
    return payout.recipientType === "team_member" ? "mo_team" : "mo_direct";
  }
  if (namedPeople.some((named) => samePerson(named, person))) return "named_person";
  return "other_person";
}

export function moAgencyCentsFromBuckets(buckets: {
  moDirectCents: number;
  moTeamCents: number;
  agencyRetainedCents: number;
}) {
  return buckets.moDirectCents + buckets.moTeamCents + buckets.agencyRetainedCents;
}

export function commissionMatchesBusinessFilters(
  commission: Pick<BusinessCommissionInput, "paidMonth" | "groupId" | "carrierId" | "lineOfBusinessId">,
  filters: Pick<ReportFilters, "paidMonth" | "startMonth" | "endMonth" | "ytd" | "groupId" | "carrierId" | "lineOfBusinessId">,
) {
  const normalized = normalizeReportFilters({ kind: "agency", ...filters });
  if (!monthInReportRange(commission.paidMonth, normalized)) return false;
  if (normalized.groupId && commission.groupId !== normalized.groupId) return false;
  if (normalized.carrierId && commission.carrierId !== normalized.carrierId) return false;
  if (normalized.lineOfBusinessId && commission.lineOfBusinessId !== normalized.lineOfBusinessId) return false;
  return true;
}

function fallbackCandidate(commission: BusinessCommissionInput) {
  return {
    commissionId: commission.id,
    grossCommissionCents: commission.grossCommissionCents,
    agentCompensationCents: commission.agentCompensationCents ?? 0,
    agencyNetCents: commission.agencyNetCents ?? commission.grossCommissionCents,
    payouts: commission.payouts.map((payout) => ({
      recipientType: payout.recipientType,
      allocationId: payout.allocationId ?? null,
      allocationBps: payout.allocationBps ?? 0,
      compensationCents: payout.compensationCents,
    })),
    hasPriorCorrection: Boolean(commission.hasPriorCorrection),
  };
}

export type MonthlyReconciliation = {
  paidMonth: string;
  postedCommissionCount: number;
  grossCents: number;
  moDirectCents: number;
  moTeamCents: number;
  agencyRetainedCents: number;
  fallbackAgencyCents: number;
  fallbackCommissionCount: number;
  legacyNoPayoutCents: number;
  legacyNoPayoutCount: number;
  inconsistentCents: number;
  inconsistentCount: number;
  moAgencyCents: number;
  namedCents: Record<string, number>;
  otherCents: number;
  unresolvedCents: number;
  fallbackPresentedAsUnresolvedCents: number;
  teamParentCents: number;
  canonicalPayoutTotalCents: number;
  underDistributedCents: number;
  overDistributedCents: number;
  unclassifiedCents: number;
  accountedClassifiedTotalCents: number;
  accountedCents: number;
  differenceCents: number;
  payableReady: boolean;
  payableReadyMessage: string | null;
  missingOwnerMonths: string[];
};

function emptyReconciliation(paidMonth: string, namedPeople: NamedBusinessPerson[]): MonthlyReconciliation {
  return {
    paidMonth,
    postedCommissionCount: 0,
    grossCents: 0,
    moDirectCents: 0,
    moTeamCents: 0,
    agencyRetainedCents: 0,
    fallbackAgencyCents: 0,
    fallbackCommissionCount: 0,
    legacyNoPayoutCents: 0,
    legacyNoPayoutCount: 0,
    inconsistentCents: 0,
    inconsistentCount: 0,
    moAgencyCents: 0,
    namedCents: Object.fromEntries(namedPeople.map((person) => [personKey(person), 0])),
    otherCents: 0,
    unresolvedCents: 0,
    fallbackPresentedAsUnresolvedCents: 0,
    teamParentCents: 0,
    canonicalPayoutTotalCents: 0,
    underDistributedCents: 0,
    overDistributedCents: 0,
    unclassifiedCents: 0,
    accountedClassifiedTotalCents: 0,
    accountedCents: 0,
    differenceCents: 0,
    payableReady: true,
    payableReadyMessage: null,
    missingOwnerMonths: [],
  };
}

export function reconcilePostedCommissions(input: {
  paidMonth: string;
  owner: PersonIdentity | null;
  namedPeople: NamedBusinessPerson[];
  commissions: BusinessCommissionInput[];
  filters?: Pick<ReportFilters, "paidMonth" | "startMonth" | "endMonth" | "ytd" | "groupId" | "carrierId" | "lineOfBusinessId">;
  ownerForPaidMonth?: (paidMonth: string) => PersonIdentity | null;
}): MonthlyReconciliation {
  const filters = input.filters ?? { paidMonth: input.paidMonth };
  const totals = emptyReconciliation(input.paidMonth, input.namedPeople);
  const ownerAt = input.ownerForPaidMonth ?? (() => input.owner);
  const monthsWithCommissions = new Set<string>();

  for (const commission of input.commissions) {
    if (!commissionMatchesBusinessFilters(commission, filters)) continue;
    totals.postedCommissionCount += 1;
    totals.grossCents += commission.grossCommissionCents;
    monthsWithCommissions.add(commission.paidMonth);
    const owner = ownerAt(commission.paidMonth);

    const leaf = commission.payouts.filter((payout) => payout.recipientType !== "team");
    const leafSum = leaf.reduce((sum, payout) => sum + payout.compensationCents, 0);
    const teamParent = commission.payouts
      .filter((payout) => payout.recipientType === "team")
      .reduce((sum, payout) => sum + payout.compensationCents, 0);
    totals.teamParentCents += teamParent;
    totals.canonicalPayoutTotalCents += leafSum;

    const candidate = fallbackCandidate(commission);
    if (isLegacyNoPayoutSnapshot(candidate)) {
      totals.legacyNoPayoutCount += 1;
      totals.legacyNoPayoutCents += commission.grossCommissionCents;
      continue;
    }
    if (isEligibleAgencyFallback(candidate)) {
      totals.fallbackCommissionCount += 1;
      totals.fallbackAgencyCents += commission.grossCommissionCents;
      continue;
    }

    let commissionInconsistent = false;
    for (const payout of commission.payouts) {
      const bucket = classifyBusinessPayout(payout, owner, input.namedPeople);
      if (bucket === "team_parent") continue;
      if (bucket === "mo_direct") totals.moDirectCents += payout.compensationCents;
      else if (bucket === "mo_team") totals.moTeamCents += payout.compensationCents;
      else if (bucket === "agency_retained") {
        if (owner) totals.agencyRetainedCents += payout.compensationCents;
        else {
          totals.inconsistentCents += payout.compensationCents;
          commissionInconsistent = true;
        }
      }
      else if (bucket === "inconsistent_agency") {
        totals.inconsistentCents += payout.compensationCents;
        commissionInconsistent = true;
      } else if (bucket === "named_person") {
        const person = payoutPerson(payout);
        if (person) {
          totals.namedCents[personKey(person)] = (totals.namedCents[personKey(person)] ?? 0) + payout.compensationCents;
        } else {
          totals.unclassifiedCents += payout.compensationCents;
        }
      } else {
        totals.otherCents += payout.compensationCents;
      }
    }
    if (commissionInconsistent) totals.inconsistentCount += 1;
    if (leafSum < commission.grossCommissionCents) {
      totals.underDistributedCents += commission.grossCommissionCents - leafSum;
    }
    if (leafSum > commission.grossCommissionCents) {
      totals.overDistributedCents += leafSum - commission.grossCommissionCents;
    }
  }

  const moAgencyCents = moAgencyCentsFromBuckets(totals);
  const namedTotal = Object.values(totals.namedCents).reduce((sum, cents) => sum + cents, 0);
  const unresolvedCents = totals.fallbackAgencyCents + totals.legacyNoPayoutCents + totals.inconsistentCents;
  const accountedClassifiedTotalCents = moAgencyCents
    + namedTotal
    + totals.otherCents
    + totals.fallbackAgencyCents
    + totals.legacyNoPayoutCents
    + totals.inconsistentCents
    + totals.unclassifiedCents;
  const missingOwnerMonths = [...monthsWithCommissions].filter((month) => !ownerAt(month)).sort();
  const ownerGap = payableOwnerGapMessage(missingOwnerMonths);
  const payableReady = totals.fallbackCommissionCount === 0
    && totals.legacyNoPayoutCount === 0
    && totals.inconsistentCount === 0
    && totals.underDistributedCents === 0
    && totals.overDistributedCents === 0
    && totals.unclassifiedCents === 0
    && missingOwnerMonths.length === 0;

  return {
    ...totals,
    moAgencyCents,
    unresolvedCents,
    fallbackPresentedAsUnresolvedCents: totals.fallbackAgencyCents,
    accountedClassifiedTotalCents,
    accountedCents: accountedClassifiedTotalCents,
    differenceCents: totals.grossCents - accountedClassifiedTotalCents,
    payableReady,
    payableReadyMessage: payableReady ? null : (ownerGap ?? NOT_PAYABLE_READY_MESSAGE),
    missingOwnerMonths,
  };
}

export type AllocationShareEntry = {
  recipientType: string;
  personKind?: string | null;
  personId?: number | null;
  teamId?: number | null;
  compensationBps: number;
};

export type TeamShareMember = PersonIdentity & {
  shareBps: number;
  status?: string;
  effectiveStart?: string;
  effectiveEnd?: string | null;
};

export type MembershipPeriod = {
  effectiveStart: string;
  effectiveEnd: string | null;
};

function membershipPeriodKey(member: TeamShareMember) {
  return `${member.effectiveStart ?? ""}:${member.effectiveEnd ?? ""}`;
}

export function teamMembershipPeriods(members: TeamShareMember[]): MembershipPeriod[] {
  const unique = new Map<string, MembershipPeriod>();
  for (const member of members) {
    if ((member.status ?? "active") !== "active") continue;
    if (!member.effectiveStart) continue;
    unique.set(membershipPeriodKey(member), {
      effectiveStart: member.effectiveStart,
      effectiveEnd: member.effectiveEnd ?? null,
    });
  }
  return [...unique.values()].sort((left, right) => left.effectiveStart.localeCompare(right.effectiveStart));
}

export function membersForPaidMonth(members: TeamShareMember[], paidMonth: string) {
  return members.filter((member) => (
    (member.status ?? "active") === "active"
    && Boolean(member.effectiveStart)
    && paidMonthInRange(paidMonth, member.effectiveStart!, member.effectiveEnd ?? null)
  ));
}

export function businessAllocationShares(input: {
  entries: AllocationShareEntry[];
  teams: Array<{ id: number; members: TeamShareMember[] }>;
  owner: PersonIdentity | null;
  namedPeople: NamedBusinessPerson[];
  paidMonth?: string | null;
}) {
  const named = Object.fromEntries(input.namedPeople.map((person) => [personKey(person), 0]));
  let moAgencyBps = 0;
  let otherBps = 0;
  let mixedTeamVersions = false;
  let needsPaidMonth = false;
  const membershipPeriods: MembershipPeriod[] = [];

  for (const entry of input.entries) {
    if (entry.recipientType === "agency") {
      moAgencyBps += entry.compensationBps;
      continue;
    }
    if (entry.recipientType === "person") {
      const person = payoutPerson({
        recipientType: "person",
        personKind: entry.personKind,
        personId: entry.personId,
        compensationCents: 0,
      });
      if (input.owner && samePerson(person, input.owner)) moAgencyBps += entry.compensationBps;
      else if (person && named[personKey(person)] != null) named[personKey(person)] += entry.compensationBps;
      else otherBps += entry.compensationBps;
      continue;
    }
    if (entry.recipientType !== "team" || entry.teamId == null) {
      otherBps += entry.compensationBps;
      continue;
    }
    const team = input.teams.find((item) => item.id === entry.teamId);
    const periods = teamMembershipPeriods(team?.members ?? []);
    for (const period of periods) {
      if (!membershipPeriods.some((existing) => (
        existing.effectiveStart === period.effectiveStart && existing.effectiveEnd === period.effectiveEnd
      ))) {
        membershipPeriods.push(period);
      }
    }
    let members: TeamShareMember[];
    if (input.paidMonth) {
      members = membersForPaidMonth(team?.members ?? [], input.paidMonth);
    } else if (periods.length > 1) {
      mixedTeamVersions = true;
      needsPaidMonth = true;
      continue;
    } else if (periods.length === 1) {
      members = membersForPaidMonth(team?.members ?? [], periods[0]!.effectiveStart);
    } else {
      members = [];
    }
    for (const member of members) {
      const share = Math.round((entry.compensationBps * member.shareBps) / FULL_ALLOCATION_BPS);
      if (input.owner && samePerson(member, input.owner)) moAgencyBps += share;
      else if (named[personKey(member)] != null) named[personKey(member)] += share;
      else otherBps += share;
    }
  }

  return {
    moAgencyBps,
    namedBps: named,
    otherBps,
    totalBps: moAgencyBps + Object.values(named).reduce((sum, bps) => sum + bps, 0) + otherBps,
    mixedTeamVersions,
    needsPaidMonth,
    membershipPeriods,
  };
}

export type CompensationGroupFilter = "all" | "needs_compensation" | "configured" | "historical_exceptions";

export type CompensationGroupClass = {
  groupId: number;
  groupName: string;
  activeAllocationCount: number;
  currentLineNames: string[];
  needsCompensation: boolean;
  configured: boolean;
  historicalException: boolean;
};

export function classifyCompensationGroups(input: {
  groups: Array<{ id: number; name: string }>;
  summaries: Array<{ groupId: number; groupName: string; activeAllocationCount: number; currentLineNames: string[] }>;
  missingLineCounts: Record<number, number>;
  exceptionGroupIds: number[];
}): CompensationGroupClass[] {
  const exceptionIds = new Set(input.exceptionGroupIds);
  return input.groups
    .map((group) => {
      const summary = input.summaries.find((row) => row.groupId === group.id);
      const configured = (summary?.activeAllocationCount ?? 0) > 0;
      return {
        groupId: group.id,
        groupName: group.name,
        activeAllocationCount: summary?.activeAllocationCount ?? 0,
        currentLineNames: summary?.currentLineNames ?? [],
        needsCompensation: (input.missingLineCounts[group.id] ?? 0) > 0 || !configured,
        configured,
        historicalException: exceptionIds.has(group.id),
      };
    })
    .sort((left, right) => left.groupName.localeCompare(right.groupName));
}

export function filterCompensationGroupClass(
  groups: CompensationGroupClass[],
  filter: CompensationGroupFilter,
) {
  if (filter === "needs_compensation") return groups.filter((group) => group.needsCompensation);
  if (filter === "configured") return groups.filter((group) => group.configured);
  if (filter === "historical_exceptions") return groups.filter((group) => group.historicalException);
  return groups;
}

export function compensationFilterLabel(filter: CompensationGroupFilter) {
  if (filter === "needs_compensation") return "Needs compensation";
  if (filter === "configured") return "Configured";
  if (filter === "historical_exceptions") return "Historical exceptions";
  return "All groups";
}

export type AgencyOwnerDrilldownLine = {
  carrierName: string;
  groupName: string;
  lineOfBusinessName: string;
  grossCents: number;
  moDirectCents: number;
  moTeamCents: number;
  agencyRetainedCents: number;
  fallbackAgencyCents: number;
  legacyNoPayoutCents: number;
  inconsistentCents: number;
  moAgencyCents: number;
  otherCents: number;
  distributedCents: number;
  differenceCents: number;
  settlementClass: "settled" | "historical_agency_fallback" | "legacy_no_payout_snapshot" | "inconsistent";
};

export function agencyOwnerDrilldown(input: {
  owner: PersonIdentity | null;
  commissions: BusinessCommissionInput[];
  filters?: Pick<ReportFilters, "paidMonth" | "startMonth" | "endMonth" | "ytd" | "groupId" | "carrierId" | "lineOfBusinessId">;
  ownerForPaidMonth?: (paidMonth: string) => PersonIdentity | null;
}): AgencyOwnerDrilldownLine[] {
  const filters = input.filters;
  const ownerAt = input.ownerForPaidMonth ?? (() => input.owner);
  return input.commissions.flatMap((commission): AgencyOwnerDrilldownLine[] => {
    if (filters && !commissionMatchesBusinessFilters(commission, filters)) return [];
    const owner = ownerAt(commission.paidMonth);
    const candidate = fallbackCandidate(commission);
    if (isLegacyNoPayoutSnapshot(candidate)) {
      return [{
        carrierName: commission.carrierName ?? "",
        groupName: commission.groupName ?? "",
        lineOfBusinessName: commission.lineOfBusinessName ?? "",
        grossCents: commission.grossCommissionCents,
        moDirectCents: 0,
        moTeamCents: 0,
        agencyRetainedCents: 0,
        fallbackAgencyCents: 0,
        legacyNoPayoutCents: commission.grossCommissionCents,
        inconsistentCents: 0,
        moAgencyCents: 0,
        otherCents: 0,
        distributedCents: 0,
        differenceCents: commission.grossCommissionCents,
        settlementClass: "legacy_no_payout_snapshot" as const,
      }];
    }
    if (isEligibleAgencyFallback(candidate)) {
      return [{
        carrierName: commission.carrierName ?? "",
        groupName: commission.groupName ?? "",
        lineOfBusinessName: commission.lineOfBusinessName ?? "",
        grossCents: commission.grossCommissionCents,
        moDirectCents: 0,
        moTeamCents: 0,
        agencyRetainedCents: 0,
        fallbackAgencyCents: commission.grossCommissionCents,
        legacyNoPayoutCents: 0,
        inconsistentCents: 0,
        moAgencyCents: 0,
        otherCents: 0,
        distributedCents: commission.grossCommissionCents,
        differenceCents: 0,
        settlementClass: "historical_agency_fallback" as const,
      }];
    }

    let moDirectCents = 0;
    let moTeamCents = 0;
    let agencyRetainedCents = 0;
    let inconsistentCents = 0;
    let otherCents = 0;
    for (const payout of commission.payouts) {
      const bucket = classifyBusinessPayout(payout, owner);
      if (bucket === "team_parent") continue;
      if (bucket === "mo_direct") moDirectCents += payout.compensationCents;
      else if (bucket === "mo_team") moTeamCents += payout.compensationCents;
      else if (bucket === "agency_retained") {
        if (owner) agencyRetainedCents += payout.compensationCents;
        else inconsistentCents += payout.compensationCents;
      } else if (bucket === "inconsistent_agency") inconsistentCents += payout.compensationCents;
      else otherCents += payout.compensationCents;
    }
    const leaf = commission.payouts.filter((payout) => payout.recipientType !== "team");
    const distributedCents = leaf.reduce((sum, payout) => sum + payout.compensationCents, 0);
    return [{
      carrierName: commission.carrierName ?? "",
      groupName: commission.groupName ?? "",
      lineOfBusinessName: commission.lineOfBusinessName ?? "",
      grossCents: commission.grossCommissionCents,
      moDirectCents,
      moTeamCents,
      agencyRetainedCents,
      fallbackAgencyCents: 0,
      legacyNoPayoutCents: 0,
      inconsistentCents,
      moAgencyCents: moAgencyCentsFromBuckets({ moDirectCents, moTeamCents, agencyRetainedCents }),
      otherCents,
      distributedCents,
      differenceCents: commission.grossCommissionCents - distributedCents,
      settlementClass: inconsistentCents ? "inconsistent" as const : "settled" as const,
    }];
  });
}

export function drilldownPayableTotals(lines: AgencyOwnerDrilldownLine[]) {
  return lines.reduce((totals, line) => ({
    grossCents: totals.grossCents + line.grossCents,
    moAgencyCents: totals.moAgencyCents + line.moAgencyCents,
    fallbackAgencyCents: totals.fallbackAgencyCents + line.fallbackAgencyCents,
    legacyNoPayoutCents: totals.legacyNoPayoutCents + line.legacyNoPayoutCents,
    inconsistentCents: totals.inconsistentCents + line.inconsistentCents,
    otherCents: totals.otherCents + line.otherCents,
  }), {
    grossCents: 0,
    moAgencyCents: 0,
    fallbackAgencyCents: 0,
    legacyNoPayoutCents: 0,
    inconsistentCents: 0,
    otherCents: 0,
  });
}

export function businessColumnLabel(person: NamedBusinessPerson | "mo_agency" | "other") {
  if (person === "mo_agency") return AGENCY_OWNER_LABEL;
  if (person === "other") return "Other";
  return person.label;
}
