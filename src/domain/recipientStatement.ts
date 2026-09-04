import type { IndividualReportRow } from "./reports";

export type UnallocatedPostedCommission = {
  commissionId: number;
  groupName: string;
  lineOfBusinessName: string;
  paidMonth: string;
  grossCommissionCents: number;
};

export type RecipientPayableReadiness = {
  payableReady: boolean;
  unallocated: UnallocatedPostedCommission[];
  message: string | null;
};

export function formatAllocationPercent(bps: number) {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

export function recipientPayableReadiness(input: {
  assignedGroupIds: number[];
  postedCommissions: Array<{
    id: number;
    groupId: number;
    groupName: string;
    lineOfBusinessName: string;
    paidMonth: string;
    grossCommissionCents: number;
    hasAllocation: boolean;
  }>;
}): RecipientPayableReadiness {
  const unallocated = input.postedCommissions
    .filter((row) => input.assignedGroupIds.includes(row.groupId) && !row.hasAllocation)
    .map((row) => ({
      commissionId: row.id,
      groupName: row.groupName,
      lineOfBusinessName: row.lineOfBusinessName,
      paidMonth: row.paidMonth,
      grossCommissionCents: row.grossCommissionCents,
    }));
  return {
    payableReady: unallocated.length === 0,
    unallocated,
    message: unallocated.length === 0
      ? null
      : `${unallocated.length} posted commission${unallocated.length === 1 ? "" : "s"} on this person's assigned groups ${unallocated.length === 1 ? "has" : "have"} no complete allocation. ${unallocated.length === 1 ? "It settled" : "They settled"} as 100% Agency and ${unallocated.length === 1 ? "is" : "are"} not included as producer pay. Confirm compensation before treating this statement as payable-ready.`,
  };
}

export function recipientStatementDisclaimer() {
  return "This statement shows amounts calculated as payable from posted commissions and stored payout snapshots. Generating it does not mean the recipient has been paid.";
}

export function sourceCommissionIds(rows: Array<Pick<IndividualReportRow, "commissionId">>) {
  return [...new Set(rows.flatMap((row) => row.commissionId == null ? [] : [row.commissionId]))].sort((left, right) => left - right);
}
