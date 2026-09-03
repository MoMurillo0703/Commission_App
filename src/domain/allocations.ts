import { paidMonthInRange, paidMonthRangesOverlap, previousPaidMonth } from "./dates";
import { calculateAgentCompensationCents } from "./compensation";

export const FULL_ALLOCATION_BPS = 10000;
export const MAX_DIRECT_PERSONS = 5;

export type PersonKind = "agent" | "account_manager";
export type RecipientType = "agency" | "person" | "team";
export type AllocationStatus = "active" | "inactive";
export type PayoutRecipientType = "agency" | "person" | "team" | "team_member";

export type AllocationEntryInput = {
  recipientType: RecipientType;
  personKind?: PersonKind | null;
  personId?: number | null;
  teamId?: number | null;
  compensationBps: number;
};

export type AllocationCandidate = {
  id: number;
  groupId: number;
  lineOfBusinessId: number;
  effectiveStart: string;
  effectiveEnd: string | null;
  status: AllocationStatus;
  entries: AllocationEntryInput[];
};

export type TeamMemberShare = {
  personKind: PersonKind;
  personId: number;
  name: string;
  shareBps: number;
};

export type TeamShare = {
  id: number;
  name: string;
  members: TeamMemberShare[];
};

export type SettledPayout = {
  recipientType: PayoutRecipientType;
  personKind: PersonKind | null;
  personId: number | null;
  personName: string | null;
  teamId: number | null;
  teamName: string | null;
  parentKey: string | null;
  allocationBps: number;
  teamInternalBps: number | null;
  compensationCents: number;
  key: string;
};

export type SettledAllocation = {
  allocatedBps: number;
  remainingBps: number;
  complete: boolean;
  compensationDistributedCents: number;
  agencyNetCents: number;
  payouts: SettledPayout[];
};

export function allocationTotals(entries: Array<{ compensationBps?: number; shareBps?: number }>) {
  const allocatedBps = entries.reduce((sum, entry) => sum + (entry.compensationBps ?? entry.shareBps ?? 0), 0);
  const remainingBps = FULL_ALLOCATION_BPS - allocatedBps;
  return {
    allocatedBps,
    remainingBps,
    complete: allocatedBps === FULL_ALLOCATION_BPS,
    over: allocatedBps > FULL_ALLOCATION_BPS,
    under: allocatedBps < FULL_ALLOCATION_BPS,
  };
}

export function allocationProgressLabel(entries: Array<{ compensationBps?: number; shareBps?: number }>) {
  const totals = allocationTotals(entries);
  const allocatedPct = (totals.allocatedBps / 100).toFixed(totals.allocatedBps % 100 === 0 ? 0 : 2);
  if (totals.complete) return `Allocated: 100% · Complete`;
  const remainingPct = (Math.abs(totals.remainingBps) / 100).toFixed(Math.abs(totals.remainingBps) % 100 === 0 ? 0 : 2);
  if (totals.over) return `Allocated: ${allocatedPct}% · Over by ${remainingPct}%`;
  return `Allocated: ${allocatedPct}% · Remaining: ${remainingPct}%`;
}

export function recipientKey(entry: AllocationEntryInput) {
  if (entry.recipientType === "agency") return "agency";
  if (entry.recipientType === "team") return `team:${entry.teamId}`;
  return `person:${entry.personKind}:${entry.personId}`;
}

export function validateAllocationEntries(
  entries: AllocationEntryInput[],
  options: { requireComplete?: boolean } = {},
) {
  if (entries.length === 0) {
    throw new Error("Add at least one recipient before saving an allocation.");
  }

  let agencyCount = 0;
  let personCount = 0;
  const seen = new Set<string>();

  for (const entry of entries) {
    if (!Number.isInteger(entry.compensationBps) || entry.compensationBps <= 0 || entry.compensationBps > FULL_ALLOCATION_BPS) {
      throw new Error("Every split must be greater than 0 and no more than 100 percent.");
    }
    if (entry.recipientType === "agency") {
      agencyCount += 1;
      if (agencyCount > 1) throw new Error("An allocation can include Agency share only once.");
    } else if (entry.recipientType === "person") {
      if (entry.personKind !== "agent" && entry.personKind !== "account_manager") {
        throw new Error("Choose a person from People.");
      }
      if (entry.personId == null) throw new Error("Choose a person from People.");
      personCount += 1;
      if (personCount > MAX_DIRECT_PERSONS) {
        throw new Error("A direct allocation can include at most 5 individual people in addition to Agency and Team.");
      }
    } else if (entry.recipientType === "team") {
      if (entry.teamId == null) throw new Error("Choose a team.");
    } else {
      throw new Error("Unknown allocation recipient.");
    }
    const key = recipientKey(entry);
    if (seen.has(key)) throw new Error("Each recipient can appear only once in an allocation.");
    seen.add(key);
  }

  const totals = allocationTotals(entries);
  if (options.requireComplete !== false && !totals.complete) {
    if (totals.over) throw new Error("Allocation cannot exceed 100 percent. Every percentage must be explicit.");
    throw new Error("Allocation must total exactly 100 percent before it can become active.");
  }
  return totals;
}

export function validateTeamMemberShares(members: Array<{ shareBps: number; personKind?: PersonKind; personId?: number }>) {
  if (members.length === 0) throw new Error("Add at least one team member.");
  const seen = new Set<string>();
  for (const member of members) {
    if (!Number.isInteger(member.shareBps) || member.shareBps <= 0 || member.shareBps > FULL_ALLOCATION_BPS) {
      throw new Error("Each team member split must be greater than 0 and no more than 100 percent.");
    }
    if (member.personKind && member.personId != null) {
      const key = `${member.personKind}:${member.personId}`;
      if (seen.has(key)) throw new Error("Each person can appear only once in a Team composition.");
      seen.add(key);
    }
  }
  const totals = allocationTotals(members);
  if (!totals.complete) {
    if (totals.over) throw new Error("Team member splits cannot exceed 100 percent.");
    throw new Error("Team member splits must total exactly 100 percent.");
  }
  return totals;
}

export function resolveCompensationAllocation(
  allocations: AllocationCandidate[],
  query: { groupId: number; lineOfBusinessId: number; paidMonth: string },
) {
  return allocations
    .filter((allocation) => (
      allocation.status === "active"
      && allocation.groupId === query.groupId
      && allocation.lineOfBusinessId === query.lineOfBusinessId
      && paidMonthInRange(query.paidMonth, allocation.effectiveStart, allocation.effectiveEnd)
    ))
    .sort((left, right) => right.effectiveStart.localeCompare(left.effectiveStart))[0] ?? null;
}

export function overlappingActiveAllocations<T extends { status: AllocationStatus; effectiveStart: string; effectiveEnd: string | null }>(
  allocations: T[],
  start: string,
  end: string | null,
) {
  return allocations.filter((allocation) => (
    allocation.status === "active"
    && paidMonthRangesOverlap(allocation.effectiveStart, allocation.effectiveEnd, start, end)
  ));
}

export function closePriorAllocationEnd(newStart: string) {
  return previousPaidMonth(newStart);
}

function largestRemainderCents(grossCommissionCents: number, shares: Array<{ key: string; bps: number }>) {
  const raw = shares.map((share) => {
    const exact = (grossCommissionCents * share.bps) / FULL_ALLOCATION_BPS;
    const cents = Math.floor(exact);
    return { ...share, cents, remainder: exact - cents };
  });
  let leftover = grossCommissionCents - raw.reduce((sum, row) => sum + row.cents, 0);
  raw.sort((left, right) => right.remainder - left.remainder || left.key.localeCompare(right.key));
  for (const row of raw) {
    if (leftover === 0) break;
    const step = leftover > 0 ? 1 : -1;
    row.cents += step;
    leftover -= step;
  }
  return new Map(raw.map((row) => [row.key, row.cents]));
}

export function expandAllocationLeaves(
  entries: AllocationEntryInput[],
  teams: Map<number, TeamShare>,
  names: {
    agencyName?: string;
    personName: (kind: PersonKind, id: number) => string;
  },
): Array<Omit<SettledPayout, "compensationCents">> {
  const leaves: Array<Omit<SettledPayout, "compensationCents">> = [];
  for (const entry of entries) {
    if (entry.recipientType === "agency") {
      leaves.push({
        recipientType: "agency",
        personKind: null,
        personId: null,
        personName: names.agencyName ?? "Agency",
        teamId: null,
        teamName: null,
        parentKey: null,
        allocationBps: entry.compensationBps,
        teamInternalBps: null,
        key: "agency",
      });
      continue;
    }
    if (entry.recipientType === "person") {
      const personKind = entry.personKind!;
      const personId = entry.personId!;
      leaves.push({
        recipientType: "person",
        personKind,
        personId,
        personName: names.personName(personKind, personId),
        teamId: null,
        teamName: null,
        parentKey: null,
        allocationBps: entry.compensationBps,
        teamInternalBps: null,
        key: recipientKey(entry),
      });
      continue;
    }
    const team = teams.get(entry.teamId!);
    if (!team) throw new Error("Team not found.");
    validateTeamMemberShares(team.members);
    const teamKey = recipientKey(entry);
    leaves.push({
      recipientType: "team",
      personKind: null,
      personId: null,
      personName: null,
      teamId: team.id,
      teamName: team.name,
      parentKey: null,
      allocationBps: entry.compensationBps,
      teamInternalBps: FULL_ALLOCATION_BPS,
      key: teamKey,
    });
    const memberBps = largestRemainderBps(entry.compensationBps, team.members.map((member) => ({
      key: `${teamKey}:member:${member.personKind}:${member.personId}`,
      bps: member.shareBps,
    })));
    for (const member of team.members) {
      const key = `${teamKey}:member:${member.personKind}:${member.personId}`;
      leaves.push({
        recipientType: "team_member",
        personKind: member.personKind,
        personId: member.personId,
        personName: member.name,
        teamId: team.id,
        teamName: team.name,
        parentKey: teamKey,
        allocationBps: memberBps.get(key) ?? 0,
        teamInternalBps: member.shareBps,
        key,
      });
    }
  }
  return leaves;
}

function largestRemainderBps(parentBps: number, shares: Array<{ key: string; bps: number }>) {
  const raw = shares.map((share) => {
    const exact = (parentBps * share.bps) / FULL_ALLOCATION_BPS;
    const value = Math.floor(exact);
    return { ...share, value, remainder: exact - value };
  });
  let leftover = parentBps - raw.reduce((sum, row) => sum + row.value, 0);
  raw.sort((left, right) => right.remainder - left.remainder || left.key.localeCompare(right.key));
  for (const row of raw) {
    if (leftover === 0) break;
    const step = leftover > 0 ? 1 : -1;
    row.value += step;
    leftover -= step;
  }
  return new Map(raw.map((row) => [row.key, row.value]));
}

export function settleAllocation(
  grossCommissionCents: number,
  entries: AllocationEntryInput[],
  teams: Map<number, TeamShare>,
  names: {
    agencyName?: string;
    personName: (kind: PersonKind, id: number) => string;
  },
): SettledAllocation {
  validateAllocationEntries(entries, { requireComplete: true });
  const leaves = expandAllocationLeaves(entries, teams, names);
  const moneyLeaves = leaves.filter((leaf) => leaf.recipientType === "agency" || leaf.recipientType === "person" || leaf.recipientType === "team");
  const parentCents = largestRemainderCents(
    grossCommissionCents,
    moneyLeaves.map((leaf) => ({ key: leaf.key, bps: leaf.allocationBps })),
  );
  const centsByKey = new Map(parentCents);
  for (const teamLeaf of leaves.filter((leaf) => leaf.recipientType === "team")) {
    const members = leaves.filter((leaf) => leaf.parentKey === teamLeaf.key);
    const teamCents = parentCents.get(teamLeaf.key) ?? 0;
    const memberCents = largestRemainderCents(
      teamCents,
      members.map((member) => ({ key: member.key, bps: member.teamInternalBps ?? 0 })),
    );
    for (const [key, cents] of memberCents) centsByKey.set(key, cents);
  }
  const payouts: SettledPayout[] = leaves.map((leaf) => {
    if (leaf.recipientType === "team") {
      const memberCents = leaves
        .filter((item) => item.parentKey === leaf.key)
        .reduce((sum, item) => sum + (centsByKey.get(item.key) ?? 0), 0);
      return { ...leaf, compensationCents: memberCents };
    }
    return { ...leaf, compensationCents: centsByKey.get(leaf.key) ?? 0 };
  });
  const agencyNetCents = payouts
    .filter((payout) => payout.recipientType === "agency")
    .reduce((sum, payout) => sum + payout.compensationCents, 0);
  const compensationDistributedCents = payouts
    .filter((payout) => payout.recipientType === "person" || payout.recipientType === "team_member")
    .reduce((sum, payout) => sum + payout.compensationCents, 0);
  const totals = allocationTotals(entries);
  return {
    allocatedBps: totals.allocatedBps,
    remainingBps: totals.remainingBps,
    complete: totals.complete,
    compensationDistributedCents,
    agencyNetCents,
    payouts,
  };
}

export function implicitAgencyAllocation(grossCommissionCents: number, agencyName = "Agency"): SettledAllocation {
  return {
    allocatedBps: FULL_ALLOCATION_BPS,
    remainingBps: 0,
    complete: true,
    compensationDistributedCents: 0,
    agencyNetCents: grossCommissionCents,
    payouts: [{
      recipientType: "agency",
      personKind: null,
      personId: null,
      personName: agencyName,
      teamId: null,
      teamName: null,
      parentKey: null,
      allocationBps: FULL_ALLOCATION_BPS,
      teamInternalBps: null,
      compensationCents: grossCommissionCents,
      key: "agency",
    }],
  };
}

export function allocationFromLegacyAgreement(
  compensationBps: number,
  person: { personKind: PersonKind; personId: number; name: string },
): AllocationEntryInput[] {
  return [{
    recipientType: "person",
    personKind: person.personKind,
    personId: person.personId,
    compensationBps,
  }];
}

export function allocationFromExplicitAgentOverride(
  compensationBps: number,
  person: { personKind: PersonKind; personId: number; name: string },
): AllocationEntryInput[] {
  const entries = allocationFromLegacyAgreement(compensationBps, person);
  const remainder = FULL_ALLOCATION_BPS - compensationBps;
  if (remainder > 0) entries.push({ recipientType: "agency", compensationBps: remainder });
  return entries;
}

export function applicableBpsForPerson(
  settled: SettledAllocation,
  person: { personKind: PersonKind; personId: number },
) {
  return settled.payouts
    .filter((payout) => (
      (payout.recipientType === "person" || payout.recipientType === "team_member")
      && payout.personKind === person.personKind
      && payout.personId === person.personId
    ))
    .reduce((sum, payout) => sum + payout.allocationBps, 0);
}

export function centsForPerson(
  settled: SettledAllocation,
  person: { personKind: PersonKind; personId: number },
) {
  return settled.payouts
    .filter((payout) => (
      (payout.recipientType === "person" || payout.recipientType === "team_member")
      && payout.personKind === person.personKind
      && payout.personId === person.personId
    ))
    .reduce((sum, payout) => sum + payout.compensationCents, 0);
}

export function previewCompensationBps(
  settled: SettledAllocation | null,
  agentId: number | null,
) {
  if (!settled) return 0;
  if (agentId == null) return 0;
  return applicableBpsForPerson(settled, { personKind: "agent", personId: agentId });
}

export function headerCompensationBps(settled: SettledAllocation) {
  return settled.payouts
    .filter((payout) => payout.recipientType === "person" || payout.recipientType === "team")
    .reduce((sum, payout) => sum + payout.allocationBps, 0);
}

export function settleLegacySingleRate(grossCommissionCents: number, compensationBps: number) {
  const agentCompensationCents = calculateAgentCompensationCents(grossCommissionCents, compensationBps);
  return {
    compensationBps,
    agentCompensationCents,
    agencyNetCents: grossCommissionCents - agentCompensationCents,
  };
}
