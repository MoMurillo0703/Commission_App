import {
  overlappingActiveAllocations,
  type AllocationEntryInput,
  type AllocationStatus,
  type PersonKind,
} from "./allocations";
import { paidMonthInRange } from "./dates";

export type TeamMemberTerm = {
  personKind: PersonKind;
  personId: number;
  shareBps: number;
};

export type AllocationTerms = {
  groupId: number;
  lineOfBusinessId: number;
  effectiveStart: string;
  effectiveEnd?: string | null;
  status?: AllocationStatus;
  entries: AllocationEntryInput[];
  teamMembersById?: Record<number, TeamMemberTerm[]>;
};

export type PersistedAllocationTerms = {
  id?: number;
  groupId: number;
  lineOfBusinessId: number;
  effectiveStart: string;
  effectiveEnd: string | null;
  status: AllocationStatus;
  entries: Array<{
    recipientType: AllocationEntryInput["recipientType"];
    personKind?: PersonKind | null;
    personId?: number | null;
    teamId?: number | null;
    compensationBps: number;
  }>;
};

export type AllocationTermsClass = "exact" | "conflict" | "missing";
export type AllocationSetClass = "exact" | "conflict" | "missing" | "partial";

function normalizeEnd(value: string | null | undefined) {
  return value ?? null;
}

function normalizeEntry(entry: AllocationEntryInput | PersistedAllocationTerms["entries"][number]) {
  return {
    recipientType: entry.recipientType,
    personKind: entry.recipientType === "person" ? entry.personKind ?? null : null,
    personId: entry.recipientType === "person" ? entry.personId ?? null : null,
    teamId: entry.recipientType === "team" ? entry.teamId ?? null : null,
    compensationBps: entry.compensationBps,
  };
}

function entryFingerprint(entry: ReturnType<typeof normalizeEntry>) {
  return [
    entry.recipientType,
    entry.personKind ?? "",
    entry.personId ?? "",
    entry.teamId ?? "",
    entry.compensationBps,
  ].join(":");
}

export function allocationEntriesMatch(
  left: AllocationTerms["entries"],
  right: PersistedAllocationTerms["entries"],
) {
  if (left.length !== right.length) return false;
  const a = left.map((entry) => entryFingerprint(normalizeEntry(entry))).sort();
  const b = right.map((entry) => entryFingerprint(normalizeEntry(entry))).sort();
  return a.every((value, index) => value === b[index]);
}

export function teamMemberFingerprint(members: TeamMemberTerm[] | undefined) {
  return (members ?? [])
    .map((member) => `${member.personKind}:${member.personId}:${member.shareBps}`)
    .sort()
    .join("|");
}

export function teamMemberTermsById(
  teams: Array<{
    id: number;
    members: Array<{
      personKind: PersonKind;
      personId: number;
      shareBps: number;
      status?: string;
      effectiveStart: string;
      effectiveEnd: string | null;
    }>;
  }>,
  asOfMonth: string,
) {
  return new Map(teams.map((team) => [
    team.id,
    team.members
      .filter((member) => (
        (member.status ?? "active") === "active"
        && paidMonthInRange(asOfMonth, member.effectiveStart, member.effectiveEnd)
      ))
      .map((member) => ({
        personKind: member.personKind,
        personId: member.personId,
        shareBps: member.shareBps,
      })),
  ]));
}

function teamDistributionMatches(
  requested: AllocationTerms,
  persisted: PersistedAllocationTerms,
  teamsById?: Map<number, TeamMemberTerm[]>,
) {
  const requestedTeams = requested.entries.flatMap((entry) => (
    entry.recipientType === "team" && entry.teamId != null ? [entry.teamId] : []
  ));
  return requestedTeams.every((teamId) => {
    if (!persisted.entries.some((entry) => entry.recipientType === "team" && entry.teamId === teamId)) {
      return false;
    }
    const expected = requested.teamMembersById?.[teamId];
    const canonical = teamsById?.get(teamId);
    if (expected && canonical) return teamMemberFingerprint(expected) === teamMemberFingerprint(canonical);
    if (expected && teamsById && !canonical) return false;
    return true;
  });
}

export function allocationHasExactTerms(
  persisted: PersistedAllocationTerms,
  requested: AllocationTerms,
  teamsById?: Map<number, TeamMemberTerm[]>,
) {
  const requestedStatus = requested.status ?? "active";
  if (persisted.groupId !== requested.groupId) return false;
  if (persisted.lineOfBusinessId !== requested.lineOfBusinessId) return false;
  if (persisted.effectiveStart !== requested.effectiveStart) return false;
  if (normalizeEnd(persisted.effectiveEnd) !== normalizeEnd(requested.effectiveEnd)) return false;
  if (requestedStatus === "active" && persisted.status !== "active") return false;
  if (requestedStatus === "inactive" && persisted.status !== "inactive") return false;
  if (!paidMonthInRange(requested.effectiveStart, persisted.effectiveStart, persisted.effectiveEnd)) return false;
  if (!allocationEntriesMatch(requested.entries, persisted.entries)) return false;
  return teamDistributionMatches(requested, persisted, teamsById);
}

export function classifyRequestedAllocation(
  allocations: PersistedAllocationTerms[],
  requested: AllocationTerms,
  teamsById?: Map<number, TeamMemberTerm[]>,
): { status: AllocationTermsClass; allocation: PersistedAllocationTerms | null } {
  const siblings = allocations.filter((allocation) => (
    allocation.groupId === requested.groupId
    && allocation.lineOfBusinessId === requested.lineOfBusinessId
  ));
  const overlaps = overlappingActiveAllocations(
    siblings,
    requested.effectiveStart,
    normalizeEnd(requested.effectiveEnd),
  );
  const exact = [...overlaps, ...siblings].find((allocation) => (
    allocationHasExactTerms(allocation, requested, teamsById)
  )) ?? null;
  if (exact) return { status: "exact", allocation: exact };
  if (overlaps.length > 0) return { status: "conflict", allocation: overlaps[0] ?? null };
  return { status: "missing", allocation: null };
}

export function allocationConflictReviewMessage() {
  return "A different compensation allocation already exists for this group, line, and period. The existing allocation was not changed. Review the current allocation before saving a different split.";
}

export function classifyRequestedAllocationSet(
  allocations: PersistedAllocationTerms[],
  requested: AllocationTerms[],
  teamsById?: Map<number, TeamMemberTerm[]>,
): { status: AllocationSetClass; results: Array<ReturnType<typeof classifyRequestedAllocation>> } {
  const results = requested.map((item) => classifyRequestedAllocation(allocations, item, teamsById));
  if (results.some((item) => item.status === "conflict")) return { status: "conflict", results };
  if (results.length > 0 && results.every((item) => item.status === "exact")) return { status: "exact", results };
  if (results.every((item) => item.status === "missing")) return { status: "missing", results };
  return { status: "partial", results };
}
