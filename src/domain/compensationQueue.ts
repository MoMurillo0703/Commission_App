import { allocationTotals, resolveCompensationAllocation, type AllocationCandidate } from "./allocations";

export type CompensationQueueReason = "missing" | "incomplete" | "inactive" | "not_covering";

export type CompensationQueueItem = {
  key: string;
  groupId: number;
  groupName: string;
  lineOfBusinessId: number;
  lineOfBusinessName: string;
  reason: CompensationQueueReason;
  reasonLabel: string;
  suggestedEffectiveStart: string;
};

export type PostedGroupLobMonth = {
  groupId: number;
  lineOfBusinessId: number;
  paidMonth: string;
};

export function queueAllocationCandidates(rows: Array<{
  id: number;
  groupId: number;
  lineOfBusinessId: number;
  effectiveStart: string;
  effectiveEnd: string | null;
  status: AllocationCandidate["status"];
  entries: AllocationCandidate["entries"];
}>): AllocationCandidate[] {
  return rows.map((allocation) => ({
    id: allocation.id,
    groupId: allocation.groupId,
    lineOfBusinessId: allocation.lineOfBusinessId,
    effectiveStart: allocation.effectiveStart,
    effectiveEnd: allocation.effectiveEnd,
    status: allocation.status,
    entries: allocation.entries,
  }));
}

function queueKey(groupId: number, lineOfBusinessId: number) {
  return `${groupId}:${lineOfBusinessId}`;
}

export function allocationNeedsReview(allocation: Pick<AllocationCandidate, "status" | "entries">) {
  const totals = allocationTotals(allocation.entries);
  if (allocation.status !== "active") return totals.complete ? "inactive" as const : "incomplete" as const;
  return totals.complete ? null : "incomplete" as const;
}

export function queueReasonLabel(reason: CompensationQueueReason) {
  if (reason === "incomplete") return "Incomplete / review required";
  if (reason === "inactive") return "Inactive allocation";
  if (reason === "not_covering") return "No active 100% allocation for the posted paid months";
  return "Missing compensation allocation";
}

function preferReason(current: CompensationQueueReason | null, next: CompensationQueueReason) {
  const rank = { incomplete: 0, inactive: 1, not_covering: 2, missing: 3 };
  if (!current) return next;
  return rank[next] < rank[current] ? next : current;
}

export function identifyCompensationQueue(input: {
  groups: Array<{ id: number; name: string }>;
  linesOfBusiness: Array<{ id: number; name: string }>;
  allocations: AllocationCandidate[];
  posted: PostedGroupLobMonth[];
  asOfMonth: string;
}): CompensationQueueItem[] {
  const groupNames = new Map(input.groups.map((group) => [group.id, group.name]));
  const lineNames = new Map(input.linesOfBusiness.map((line) => [line.id, line.name]));
  const pairs = new Map<string, { groupId: number; lineOfBusinessId: number; paidMonths: string[] }>();

  function addPair(groupId: number, lineOfBusinessId: number, paidMonth?: string) {
    const key = queueKey(groupId, lineOfBusinessId);
    const existing = pairs.get(key) ?? { groupId, lineOfBusinessId, paidMonths: [] };
    if (paidMonth && !existing.paidMonths.includes(paidMonth)) existing.paidMonths.push(paidMonth);
    pairs.set(key, existing);
  }

  for (const row of input.posted) addPair(row.groupId, row.lineOfBusinessId, row.paidMonth);
  for (const allocation of input.allocations) addPair(allocation.groupId, allocation.lineOfBusinessId);

  const items: CompensationQueueItem[] = [];
  for (const pair of pairs.values()) {
    const siblings = input.allocations.filter((allocation) => (
      allocation.groupId === pair.groupId && allocation.lineOfBusinessId === pair.lineOfBusinessId
    ));
    const months = pair.paidMonths.length > 0 ? pair.paidMonths : [input.asOfMonth];
    const allCovered = months.every((month) => {
      const applicable = resolveCompensationAllocation(siblings, {
        groupId: pair.groupId,
        lineOfBusinessId: pair.lineOfBusinessId,
        paidMonth: month,
      });
      return Boolean(applicable && !allocationNeedsReview(applicable));
    });
    if (allCovered) continue;

    let reason: CompensationQueueReason | null = siblings.length === 0 ? "missing" : "not_covering";
    for (const allocation of siblings) {
      const review = allocationNeedsReview(allocation);
      if (review) reason = preferReason(reason, review);
    }
    items.push({
      key: queueKey(pair.groupId, pair.lineOfBusinessId),
      groupId: pair.groupId,
      groupName: groupNames.get(pair.groupId) ?? "Group",
      lineOfBusinessId: pair.lineOfBusinessId,
      lineOfBusinessName: lineNames.get(pair.lineOfBusinessId) ?? "Line of business",
      reason,
      reasonLabel: queueReasonLabel(reason),
      suggestedEffectiveStart: (pair.paidMonths.slice().sort()[0] ?? input.asOfMonth),
    });
  }

  return items.sort((left, right) => (
    left.groupName.localeCompare(right.groupName)
    || left.lineOfBusinessName.localeCompare(right.lineOfBusinessName)
  ));
}

export function queueGroupCount(items: Array<{ groupId: number }>) {
  return new Set(items.map((item) => item.groupId)).size;
}

export function queueBannerLabel(items: Array<{ groupId: number }>) {
  const count = queueGroupCount(items);
  if (count === 0) return "All groups have a complete allocation";
  return count === 1 ? "1 group needs compensation setup" : `${count} groups need compensation setup`;
}

export function skipQueueIndex(index: number, length: number) {
  if (length === 0) return { index: 0, done: true };
  const next = index + 1;
  if (next >= length) return { index: length - 1, done: true };
  return { index: next, done: false };
}

export function afterSaveQueue<T extends { key: string }>(items: T[], index: number, savedKey: string) {
  const remaining = items.filter((item) => item.key !== savedKey);
  if (remaining.length === 0) return { items: remaining, index: 0, done: true };
  return { items: remaining, index: Math.min(index, remaining.length - 1), done: false };
}

export function closeQueue() {
  return { open: false as const };
}
