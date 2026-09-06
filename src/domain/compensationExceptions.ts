import { allocationNeedsReview } from "./compensationQueue";
import { resolveCompensationAllocation, type AllocationCandidate } from "./allocations";

export type PostedCompensationException = {
  commissionId: number;
  groupId: number;
  groupName: string;
  lineOfBusinessId: number;
  lineOfBusinessName: string;
  paidMonth: string;
  grossCommissionCents: number;
  hasAllocationSnapshot: boolean;
};

export type ExceptionLineStatus = "needs_allocation" | "allocation_exists_history_unchanged";

export type GroupedCompensationException = {
  groupId: number;
  groupName: string;
  commissionCount: number;
  lines: Array<{
    lineOfBusinessId: number;
    lineOfBusinessName: string;
    commissionIds: number[];
    status: ExceptionLineStatus;
    statusLabel: string;
  }>;
};

export function postedCommissionsNeedingCompensationReview(
  commissions: PostedCompensationException[],
) {
  return commissions.filter((row) => !row.hasAllocationSnapshot);
}

export function compensationExceptionWarning(count: number) {
  if (count <= 0) return null;
  return `${count} commission${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} compensation setup. ${
    count === 1 ? "It" : "They"
  } settled as 100% Agency and ${count === 1 ? "is" : "are"} not included as producer pay.`;
}

export function remainingSettlementMessage(count: number) {
  if (count <= 0) return null;
  return `${count} posted commission${count === 1 ? "" : "s"} still ${
    count === 1 ? "has" : "have"
  } the original Agency 100% payout snapshot. Adding a current allocation does not rewrite historical payouts.`;
}

export function compensationReviewHref(input: {
  paidMonth: string;
  commissionIds: number[];
  personKind?: string | null;
  personId?: number | null;
  personName?: string | null;
}) {
  const params = new URLSearchParams({
    review: "1",
    paidMonth: input.paidMonth,
    commissionIds: input.commissionIds.join(","),
  });
  if (input.personKind) params.set("personKind", input.personKind);
  if (input.personId) params.set("personId", String(input.personId));
  if (input.personName) params.set("personName", input.personName);
  return `/compensation?${params.toString()}`;
}

export function parseCommissionIds(value: string | null | undefined) {
  return [...new Set(
    (value ?? "")
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((id) => Number.isInteger(id) && id > 0),
  )];
}

export function coveringAllocationExists(
  allocations: AllocationCandidate[],
  groupId: number,
  lineOfBusinessId: number,
  paidMonth: string,
) {
  const applicable = resolveCompensationAllocation(
    allocations.filter((row) => row.groupId === groupId && row.lineOfBusinessId === lineOfBusinessId),
    { groupId, lineOfBusinessId, paidMonth },
  );
  return Boolean(applicable && !allocationNeedsReview(applicable));
}

export function groupCompensationExceptions(
  commissions: PostedCompensationException[],
  allocations: AllocationCandidate[] = [],
): GroupedCompensationException[] {
  const needing = postedCommissionsNeedingCompensationReview(commissions);
  const byGroup = new Map<number, PostedCompensationException[]>();
  for (const row of needing) {
    const current = byGroup.get(row.groupId) ?? [];
    current.push(row);
    byGroup.set(row.groupId, current);
  }
  return [...byGroup.values()].map((rows) => {
    const first = rows[0]!;
    const byLine = new Map<number, PostedCompensationException[]>();
    for (const row of rows) {
      const current = byLine.get(row.lineOfBusinessId) ?? [];
      current.push(row);
      byLine.set(row.lineOfBusinessId, current);
    }
    return {
      groupId: first.groupId,
      groupName: first.groupName,
      commissionCount: rows.length,
      lines: [...byLine.values()].map((lineRows) => {
        const line = lineRows[0]!;
        const covered = coveringAllocationExists(
          allocations,
          line.groupId,
          line.lineOfBusinessId,
          line.paidMonth,
        );
        return {
          lineOfBusinessId: line.lineOfBusinessId,
          lineOfBusinessName: line.lineOfBusinessName,
          commissionIds: lineRows.map((row) => row.commissionId),
          status: covered ? "allocation_exists_history_unchanged" as const : "needs_allocation" as const,
          statusLabel: covered
            ? "Allocation exists — posted payouts were not rewritten"
            : "Needs allocation",
        };
      }).sort((left, right) => left.lineOfBusinessName.localeCompare(right.lineOfBusinessName)),
    };
  }).sort((left, right) => left.groupName.localeCompare(right.groupName));
}

export function remainingExceptionGroups(groups: GroupedCompensationException[]) {
  return groups.filter((group) => group.lines.some((line) => line.status === "needs_allocation"));
}

export function exceptionWorkSummary(groups: GroupedCompensationException[]) {
  const remaining = remainingExceptionGroups(groups);
  return {
    groupCount: remaining.length,
    commissionCount: remaining.reduce((sum, group) => (
      sum + group.lines
        .filter((line) => line.status === "needs_allocation")
        .reduce((lineSum, line) => lineSum + line.commissionIds.length, 0)
    ), 0),
    groups: remaining,
  };
}
