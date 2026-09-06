import { historicalAllocationState, type HistoricalAllocationState } from "./compensationCorrection";
import type { AllocationCandidate } from "./allocations";

export type PostedCompensationException = {
  commissionId: number;
  groupId: number;
  groupName: string;
  lineOfBusinessId: number;
  lineOfBusinessName: string;
  paidMonth: string;
  grossCommissionCents: number;
  carrierId?: number;
  carrierName?: string;
  eligibleFallback: boolean;
};

export type ExceptionLineStatus = "needs_allocation" | "ready_to_correct" | "blocked_newer_allocation";

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
  return commissions.filter((row) => row.eligibleFallback);
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
    count === 1 ? "is" : "are"
  } the original Agency 100% fallback. Create a paid-month allocation, then use Correct Compensation. Allocations do not rewrite payouts automatically.`;
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

function statusFromHistorical(state: HistoricalAllocationState): {
  status: ExceptionLineStatus;
  statusLabel: string;
} {
  if (state === "covers") {
    return { status: "ready_to_correct", statusLabel: "Ready to correct" };
  }
  if (state === "newer_only") {
    return { status: "blocked_newer_allocation", statusLabel: "Newer allocation only — blocked" };
  }
  return { status: "needs_allocation", statusLabel: "Needs allocation" };
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
        const classified = statusFromHistorical(historicalAllocationState(allocations, {
          groupId: line.groupId,
          lineOfBusinessId: line.lineOfBusinessId,
          paidMonth: line.paidMonth,
        }));
        return {
          lineOfBusinessId: line.lineOfBusinessId,
          lineOfBusinessName: line.lineOfBusinessName,
          commissionIds: lineRows.map((row) => row.commissionId),
          ...classified,
        };
      }).sort((left, right) => left.lineOfBusinessName.localeCompare(right.lineOfBusinessName)),
    };
  }).sort((left, right) => left.groupName.localeCompare(right.groupName));
}

export function remainingExceptionGroups(groups: GroupedCompensationException[]) {
  return groups.filter((group) => group.lines.length > 0);
}

export function exceptionWorkSummary(groups: GroupedCompensationException[]) {
  const remaining = remainingExceptionGroups(groups);
  return {
    groupCount: remaining.length,
    commissionCount: remaining.reduce((sum, group) => sum + group.commissionCount, 0),
    readyCommissionIds: remaining.flatMap((group) => (
      group.lines
        .filter((line) => line.status === "ready_to_correct")
        .flatMap((line) => line.commissionIds)
    )),
    groups: remaining,
  };
}
