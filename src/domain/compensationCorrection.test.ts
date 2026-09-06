import { describe, expect, it } from "vitest";
import { settleAllocation } from "./allocations";
import {
  correctionPreviewTotals,
  historicalAllocationForPaidMonth,
  historicalAllocationState,
  missingAllocationBlockedMessage,
  newerAllocationBlockedMessage,
  proposedCorrectionSettlement,
} from "./compensationCorrection";

const johnPerson = {
  id: 9,
  groupId: 1,
  lineOfBusinessId: 2,
  effectiveStart: "2026-09",
  effectiveEnd: null as string | null,
  status: "active" as const,
  entries: [{ recipientType: "person" as const, personKind: "agent" as const, personId: 7, compensationBps: 10000 }],
};

describe("historical paid-month allocation for correction", () => {
  it("uses a complete allocation that covers the original paid month and rejects newer-only plans", () => {
    expect(historicalAllocationState([johnPerson], {
      groupId: 1,
      lineOfBusinessId: 2,
      paidMonth: "2026-09",
    })).toBe("covers");
    expect(historicalAllocationForPaidMonth([johnPerson], {
      groupId: 1,
      lineOfBusinessId: 2,
      paidMonth: "2026-09",
    })?.id).toBe(9);

    const newer = { ...johnPerson, id: 10, effectiveStart: "2026-10" };
    expect(historicalAllocationState([newer], {
      groupId: 1,
      lineOfBusinessId: 2,
      paidMonth: "2026-09",
    })).toBe("newer_only");
    expect(historicalAllocationForPaidMonth([newer], {
      groupId: 1,
      lineOfBusinessId: 2,
      paidMonth: "2026-09",
    })).toBeNull();
    expect(newerAllocationBlockedMessage()).toMatch(/newer allocation/);
    expect(missingAllocationBlockedMessage()).toMatch(/covers the original paid month/);
  });

  it("builds original vs proposed preview totals from the existing settlement rules", () => {
    const settled = settleAllocation(10000, johnPerson.entries, new Map(), {
      personName: () => "John Elizondo",
    });
    const proposed = proposedCorrectionSettlement(settled, johnPerson);
    expect(proposed.recipientPayableCents).toBe(10000);
    expect(proposed.agencyNetCents).toBe(0);
    expect(proposed.recipients[0]).toMatchObject({
      name: "John Elizondo",
      splitPercent: "100%",
      compensationCents: 10000,
    });
    const totals = correctionPreviewTotals([{
      commissionId: 1,
      paidMonth: "2026-09",
      groupName: "ABC",
      carrierName: "Principal",
      lineOfBusinessName: "Medical",
      grossCommissionCents: 10000,
      original: { label: "Agency 100%", agencyCents: 10000, agencyNetCents: 10000 },
      proposed,
      blockedReason: null,
    }]);
    expect(totals).toEqual({
      grossCents: 10000,
      originalAgencyCents: 10000,
      proposedRecipientPayableCents: 10000,
      resultingAgencyCents: 0,
    });
  });
});
