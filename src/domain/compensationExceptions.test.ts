import { describe, expect, it } from "vitest";
import {
  compensationReviewHref,
  exceptionWorkSummary,
  groupCompensationExceptions,
  postedCommissionsNeedingCompensationReview,
  remainingSettlementMessage,
} from "./compensationExceptions";

const commissions = [
  {
    commissionId: 11,
    groupId: 1,
    groupName: "ABC COMPANY",
    lineOfBusinessId: 1,
    lineOfBusinessName: "Medical",
    paidMonth: "2026-09",
    grossCommissionCents: 10000,
    eligibleFallback: true,
  },
  {
    commissionId: 12,
    groupId: 1,
    groupName: "ABC COMPANY",
    lineOfBusinessId: 2,
    lineOfBusinessName: "Dental",
    paidMonth: "2026-09",
    grossCommissionCents: 4000,
    eligibleFallback: true,
  },
  {
    commissionId: 13,
    groupId: 2,
    groupName: "XYZ COMPANY",
    lineOfBusinessId: 1,
    lineOfBusinessName: "Medical",
    paidMonth: "2026-09",
    grossCommissionCents: 2500,
    eligibleFallback: true,
  },
  {
    commissionId: 14,
    groupId: 2,
    groupName: "XYZ COMPANY",
    lineOfBusinessId: 1,
    lineOfBusinessName: "Medical",
    paidMonth: "2026-09",
    grossCommissionCents: 800,
    eligibleFallback: false,
  },
];

describe("compensation exceptions from posted commissions", () => {
  it("groups only eligible Agency fallback commissions and does not use Group assignment", () => {
    const needing = postedCommissionsNeedingCompensationReview(commissions);
    expect(needing.map((row) => row.commissionId)).toEqual([11, 12, 13]);
    const grouped = groupCompensationExceptions(needing);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toMatchObject({ groupName: "ABC COMPANY", commissionCount: 2 });
    expect(grouped[0]?.lines.map((line) => line.lineOfBusinessName)).toEqual(["Dental", "Medical"]);
    expect(grouped[1]?.lines[0]).toMatchObject({
      lineOfBusinessName: "Medical",
      commissionIds: [13],
      statusLabel: "Needs allocation",
    });
    expect(compensationReviewHref({
      paidMonth: "2026-09",
      commissionIds: [11, 12, 13],
      personKind: "agent",
      personId: 7,
      personName: "John Elizondo",
    })).toContain("/compensation?review=1&paidMonth=2026-09&commissionIds=11%2C12%2C13");
  });

  it("keeps a Group on the work list after a covering paid-month allocation until correction", () => {
    const grouped = groupCompensationExceptions(commissions, [{
      id: 90,
      groupId: 1,
      lineOfBusinessId: 1,
      effectiveStart: "2026-09",
      effectiveEnd: null,
      status: "active",
      entries: [{ recipientType: "agency", compensationBps: 10000 }],
    }, {
      id: 91,
      groupId: 1,
      lineOfBusinessId: 2,
      effectiveStart: "2026-09",
      effectiveEnd: null,
      status: "active",
      entries: [{ recipientType: "agency", compensationBps: 10000 }],
    }]);
    expect(grouped.find((group) => group.groupId === 1)?.lines.every((line) => line.status === "ready_to_correct")).toBe(true);
    const remaining = exceptionWorkSummary(grouped);
    expect(remaining.groupCount).toBe(2);
    expect(remaining.readyCommissionIds).toEqual([12, 11]);
    expect(remainingSettlementMessage(3)).toMatch(/Correct Compensation/);
  });

  it("marks newer-only allocations as blocked", () => {
    const grouped = groupCompensationExceptions(commissions, [{
      id: 92,
      groupId: 2,
      lineOfBusinessId: 1,
      effectiveStart: "2026-10",
      effectiveEnd: null,
      status: "active",
      entries: [{ recipientType: "person", personKind: "agent", personId: 7, compensationBps: 10000 }],
    }]);
    expect(grouped.find((group) => group.groupId === 2)?.lines[0]?.status).toBe("blocked_newer_allocation");
  });
});
