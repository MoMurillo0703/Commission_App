import { describe, expect, it } from "vitest";
import {
  formatAllocationPercent,
  recipientPayableReadiness,
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
        lineOfBusinessName: "Dental",
        paidMonth: "2026-08",
        grossCommissionCents: 5000,
        hasAllocation: true,
      }],
    });
    expect(readiness.payableReady).toBe(true);
    expect(readiness.message).toBeNull();
  });

  it("surfaces missing allocations on assigned groups before calling the report payable-ready", () => {
    const readiness = recipientPayableReadiness({
      assignedGroupIds: [1, 2],
      postedCommissions: [
        {
          id: 11,
          groupId: 1,
          groupName: "Acme",
          lineOfBusinessName: "Dental",
          paidMonth: "2026-08",
          grossCommissionCents: 5000,
          hasAllocation: false,
        },
        {
          id: 12,
          groupId: 3,
          groupName: "Other",
          lineOfBusinessName: "Vision",
          paidMonth: "2026-08",
          grossCommissionCents: 2000,
          hasAllocation: false,
        },
      ],
    });
    expect(readiness.payableReady).toBe(false);
    expect(readiness.unallocated).toHaveLength(1);
    expect(readiness.unallocated[0]?.commissionId).toBe(11);
    expect(readiness.message).toMatch(/no complete allocation/);
    expect(readiness.message).toMatch(/not included as producer pay/);
  });

  it("keeps source commission IDs and does not describe the statement as a payment", () => {
    expect(sourceCommissionIds([{ commissionId: 3 }, { commissionId: 1 }, { commissionId: 3 }])).toEqual([1, 3]);
    expect(formatAllocationPercent(7000)).toBe("70%");
    expect(formatAllocationPercent(1250)).toBe("12.50%");
    expect(recipientStatementDisclaimer()).toMatch(/does not mean the recipient has been paid/);
  });
});
