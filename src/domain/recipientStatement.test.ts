import { describe, expect, it } from "vitest";
import {
  formatAllocationPercent,
  recipientPayableReadiness,
  recipientReportReviewState,
  recipientStatementDisclaimer,
  sourceCommissionIds,
} from "./recipientStatement";

describe("recipient payable readiness", () => {
  it("is payable-ready when assigned-group commissions have allocations", () => {
    const readiness = recipientPayableReadiness({
      assignedGroupIds: [1],
      postedCommissions: [{
        id: 10,
        groupId: 1,
        groupName: "Acme",
        lineOfBusinessId: 4,
        lineOfBusinessName: "Dental",
        paidMonth: "2026-08",
        grossCommissionCents: 5000,
        isEligibleFallback: false,
      }],
    });
    expect(readiness.payableReady).toBe(true);
    expect(readiness.message).toBeNull();
  });

  it("surfaces posted commissions that settled without an allocation snapshot, not Group assignment", () => {
    const readiness = recipientPayableReadiness({
      assignedGroupIds: [1, 2],
      postedCommissions: [
        {
          id: 11,
          groupId: 1,
          groupName: "Acme",
          lineOfBusinessId: 4,
          lineOfBusinessName: "Dental",
          paidMonth: "2026-08",
          grossCommissionCents: 5000,
          isEligibleFallback: true,
        },
        {
          id: 12,
          groupId: 3,
          groupName: "Other",
          lineOfBusinessId: 5,
          lineOfBusinessName: "Vision",
          paidMonth: "2026-08",
          grossCommissionCents: 2000,
          isEligibleFallback: true,
        },
        {
          id: 13,
          groupId: 1,
          groupName: "Acme",
          lineOfBusinessId: 6,
          lineOfBusinessName: "Medical",
          paidMonth: "2026-08",
          grossCommissionCents: 1000,
          isEligibleFallback: false,
        },
      ],
    });
    expect(readiness.payableReady).toBe(false);
    expect(readiness.unallocated.map((row) => row.commissionId)).toEqual([11, 12]);
    expect(readiness.message).toMatch(/2 commissions need compensation setup/);
    expect(readiness.message).toMatch(/not included as producer pay/);
  });

  it("keeps source commission IDs and does not describe the statement as a payment", () => {
    expect(sourceCommissionIds([{ commissionId: 3 }, { commissionId: 1 }, { commissionId: 3 }])).toEqual([1, 3]);
    expect(formatAllocationPercent(7000)).toBe("70%");
    expect(formatAllocationPercent(1250)).toBe("12.50%");
    expect(recipientStatementDisclaimer()).toMatch(/does not mean the recipient has been paid/);
  });

  it("does not present a missing-payout review as a $0 payroll statement", () => {
    expect(recipientReportReviewState({
      personSelected: true,
      personName: "Laura Montoya",
      payoutRowCount: 0,
      payableCents: 0,
      postedCommissionCount: 4,
      matchingCommissionCount: 4,
      unallocatedCount: 2,
    })).toMatchObject({
      kind: "missing_payouts",
      showPayableTotals: false,
    });
    expect(recipientReportReviewState({
      personSelected: true,
      personName: "John Elizando",
      payoutRowCount: 2,
      payableCents: 0,
      postedCommissionCount: 2,
      matchingCommissionCount: 2,
      unallocatedCount: 0,
    }).kind).toBe("legitimate_zero");
    expect(recipientReportReviewState({
      personSelected: false,
      personName: null,
      payoutRowCount: 0,
      payableCents: 0,
      postedCommissionCount: 4,
      matchingCommissionCount: 0,
      unallocatedCount: 0,
    })).toMatchObject({
      kind: "unknown_person",
      showPayableTotals: false,
    });
    expect(recipientReportReviewState({
      personSelected: true,
      personName: "Laura Montoya",
      payoutRowCount: 0,
      payableCents: 0,
      postedCommissionCount: 3,
      matchingCommissionCount: 0,
      unallocatedCount: 0,
    }).emptyMessage).toMatch(/No posted commissions match this paid month/);
  });
});
