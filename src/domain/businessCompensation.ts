import { FULL_ALLOCATION_BPS } from "./allocations";
import { AGENCY_OWNER_LABEL, personKey, samePerson, type PersonIdentity } from "./agencyOwner";
import { paidMonthInRange } from "./dates";

export type BusinessPayoutBucket =
  | "mo_direct"
  | "mo_team"
  | "agency_retained"
  | "fallback_agency"
  | "named_person"
  | "other_person"
  | "team_parent"
  | "unresolved";

export type BusinessPayoutInput = {
  recipientType: string;
  personKind?: string | null;
  personId?: number | null;
  allocationId?: number | null;
  compensationCents: number;
};

export type NamedBusinessPerson = PersonIdentity & { label: string };

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
    return payout.allocationId == null ? "fallback_agency" : "agency_retained";
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

export type MonthlyReconciliation = {
  paidMonth: string;
  grossCents: number;
  moDirectCents: number;
  moTeamCents: number;
  agencyRetainedCents: number;
  fallbackAgencyCents: number;
  moAgencyCents: number;
  namedCents: Record<string, number>;
  otherCents: number;
  unresolvedCents: number;
  fallbackPresentedAsUnresolvedCents: number;
  teamParentCents: number;
  accountedCents: number;
  differenceCents: number;
};

export function reconcilePostedCommissions(input: {
  paidMonth: string;
  owner: PersonIdentity | null;
  namedPeople: NamedBusinessPerson[];
  commissions: Array<{
    id: number;
    paidMonth: string;
    grossCommissionCents: number;
    payouts: BusinessPayoutInput[];
  }>;
}): MonthlyReconciliation {
  const namedCents = Object.fromEntries(input.namedPeople.map((person) => [personKey(person), 0]));
  const totals = {
    paidMonth: input.paidMonth,
    grossCents: 0,
    moDirectCents: 0,
    moTeamCents: 0,
    agencyRetainedCents: 0,
    fallbackAgencyCents: 0,
    namedCents,
    otherCents: 0,
    unresolvedCents: 0,
    teamParentCents: 0,
  };

  for (const commission of input.commissions) {
    if (commission.paidMonth !== input.paidMonth) continue;
    totals.grossCents += commission.grossCommissionCents;
    const leaf = commission.payouts.filter((payout) => payout.recipientType !== "team");
    const leafSum = leaf.reduce((sum, payout) => sum + payout.compensationCents, 0);
    totals.unresolvedCents += commission.grossCommissionCents - leafSum;
    for (const payout of commission.payouts) {
      const bucket = classifyBusinessPayout(payout, input.owner, input.namedPeople);
      if (bucket === "team_parent") {
        totals.teamParentCents += payout.compensationCents;
        continue;
      }
      if (bucket === "mo_direct") totals.moDirectCents += payout.compensationCents;
      else if (bucket === "mo_team") totals.moTeamCents += payout.compensationCents;
      else if (bucket === "agency_retained") totals.agencyRetainedCents += payout.compensationCents;
      else if (bucket === "fallback_agency") totals.fallbackAgencyCents += payout.compensationCents;
      else if (bucket === "named_person") {
        const person = payoutPerson(payout);
        if (person) totals.namedCents[personKey(person)] = (totals.namedCents[personKey(person)] ?? 0) + payout.compensationCents;
      } else {
        totals.otherCents += payout.compensationCents;
      }
    }
  }

  const moAgencyCents = moAgencyCentsFromBuckets(totals);
  const namedTotal = Object.values(totals.namedCents).reduce((sum, cents) => sum + cents, 0);
  const fallbackPresentedAsUnresolvedCents = totals.fallbackAgencyCents;
  const accountedCents = moAgencyCents
    + fallbackPresentedAsUnresolvedCents
    + namedTotal
    + totals.otherCents
    + totals.unresolvedCents;
  return {
    ...totals,
    moAgencyCents,
    fallbackPresentedAsUnresolvedCents,
    accountedCents,
    differenceCents: accountedCents - totals.grossCents,
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
    const members = (team?.members ?? []).filter((member) => (
      (member.status ?? "active") === "active"
      && (input.paidMonth == null || member.effectiveStart == null || paidMonthInRange(input.paidMonth, member.effectiveStart, member.effectiveEnd ?? null))
    ));
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
  moAgencyCents: number;
  otherCents: number;
  distributedCents: number;
  differenceCents: number;
};

export function agencyOwnerDrilldown(input: {
  owner: PersonIdentity | null;
  commissions: Array<{
    paidMonth: string;
    carrierName: string;
    groupName: string;
    lineOfBusinessName: string;
    grossCommissionCents: number;
    payouts: BusinessPayoutInput[];
  }>;
}): AgencyOwnerDrilldownLine[] {
  return input.commissions.map((commission) => {
    let moDirectCents = 0;
    let moTeamCents = 0;
    let agencyRetainedCents = 0;
    let fallbackAgencyCents = 0;
    let otherCents = 0;
    for (const payout of commission.payouts) {
      const bucket = classifyBusinessPayout(payout, input.owner);
      if (bucket === "team_parent") continue;
      if (bucket === "mo_direct") moDirectCents += payout.compensationCents;
      else if (bucket === "mo_team") moTeamCents += payout.compensationCents;
      else if (bucket === "agency_retained") agencyRetainedCents += payout.compensationCents;
      else if (bucket === "fallback_agency") fallbackAgencyCents += payout.compensationCents;
      else otherCents += payout.compensationCents;
    }
    const leaf = commission.payouts.filter((payout) => payout.recipientType !== "team");
    const distributedCents = leaf.reduce((sum, payout) => sum + payout.compensationCents, 0);
    return {
      carrierName: commission.carrierName,
      groupName: commission.groupName,
      lineOfBusinessName: commission.lineOfBusinessName,
      grossCents: commission.grossCommissionCents,
      moDirectCents,
      moTeamCents,
      agencyRetainedCents,
      fallbackAgencyCents,
      moAgencyCents: moAgencyCentsFromBuckets({ moDirectCents, moTeamCents, agencyRetainedCents }),
      otherCents,
      distributedCents,
      differenceCents: commission.grossCommissionCents - distributedCents,
    };
  });
}

export function businessColumnLabel(person: NamedBusinessPerson | "mo_agency" | "other") {
  if (person === "mo_agency") return AGENCY_OWNER_LABEL;
  if (person === "other") return "Other";
  return person.label;
}
