import { allocationTotals, type AllocationStatus } from "./allocations";

export type CompensationHomeAllocation = {
  id: number;
  groupId: number;
  groupName: string;
  lineOfBusinessId: number;
  lineOfBusinessName: string;
  effectiveStart: string;
  effectiveEnd: string | null;
  status: AllocationStatus;
  entries: Array<{
    recipientType: string;
    personName: string | null;
    teamName: string | null;
    compensationBps: number;
  }>;
};

export type CompensationGroupSummary = {
  groupId: number;
  groupName: string;
  activeAllocationCount: number;
  currentLineNames: string[];
};

export function compensationGroupSummaries(
  allocations: CompensationHomeAllocation[],
  groups: Array<{ id: number; name: string }>,
): CompensationGroupSummary[] {
  const byGroup = new Map<number, CompensationGroupSummary>();
  for (const group of groups) {
    byGroup.set(group.id, {
      groupId: group.id,
      groupName: group.name,
      activeAllocationCount: 0,
      currentLineNames: [],
    });
  }
  for (const allocation of allocations) {
    const summary = byGroup.get(allocation.groupId) ?? {
      groupId: allocation.groupId,
      groupName: allocation.groupName,
      activeAllocationCount: 0,
      currentLineNames: [],
    };
    if (allocation.status === "active") {
      summary.activeAllocationCount += 1;
      if (!summary.currentLineNames.includes(allocation.lineOfBusinessName)) {
        summary.currentLineNames.push(allocation.lineOfBusinessName);
      }
    }
    byGroup.set(allocation.groupId, summary);
  }
  return [...byGroup.values()].sort((left, right) => left.groupName.localeCompare(right.groupName));
}

export function filterCompensationGroups(groups: CompensationGroupSummary[], query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return groups;
  return groups.filter((group) => (
    group.groupName.toLowerCase().includes(needle)
    || group.currentLineNames.some((line) => line.toLowerCase().includes(needle))
  ));
}

export function currentAllocationsForGroup(allocations: CompensationHomeAllocation[], groupId: number) {
  return allocations
    .filter((row) => row.groupId === groupId && row.status === "active")
    .sort((left, right) => left.lineOfBusinessName.localeCompare(right.lineOfBusinessName));
}

export function historicalAllocationsForGroup(allocations: CompensationHomeAllocation[], groupId: number) {
  return allocations
    .filter((row) => row.groupId === groupId && row.status !== "active")
    .sort((left, right) => right.effectiveStart.localeCompare(left.effectiveStart) || left.lineOfBusinessName.localeCompare(right.lineOfBusinessName));
}

export function allocationRecipientSummary(allocation: CompensationHomeAllocation) {
  return allocation.entries
    .map((entry) => `${entry.personName ?? entry.teamName ?? "Agency"} ${((entry.compensationBps) / 100).toFixed(entry.compensationBps % 100 === 0 ? 0 : 2)}%`)
    .join(" · ");
}

export function missingLinesForGroup(
  groupId: number,
  evidence: Array<{ groupId: number; lineOfBusinessId: number }>,
  lines: Array<{ id: number; name: string }>,
  allocations: CompensationHomeAllocation[],
) {
  const activeLineIds = new Set(
    allocations
      .filter((row) => row.groupId === groupId && row.status === "active" && allocationTotals(row.entries).complete)
      .map((row) => row.lineOfBusinessId),
  );
  const needed = [...new Set(evidence.filter((item) => item.groupId === groupId).map((item) => item.lineOfBusinessId))];
  return lines.filter((line) => needed.includes(line.id) && !activeLineIds.has(line.id));
}

export function groupActiveCountLabel(count: number) {
  if (count === 1) return "1 active allocation";
  return `${count} active LOB allocations`;
}
