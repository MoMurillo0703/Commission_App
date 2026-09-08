import { describe, expect, it } from "vitest";
import { coverageReceiptsFor, missingCommissionDataReadiness } from "./coverageMonthReadiness";

describe("coverage/source month readiness", () => {
  const rows = [
    { groupId: 29, carrierId: 3, lineOfBusinessId: 2, paidMonth: "2026-09", coverageMonth: "2026-07", grossCommissionCents: 35196 },
    { groupId: 29, carrierId: 3, lineOfBusinessId: 3, paidMonth: "2026-09", coverageMonth: "2026-07", grossCommissionCents: 4522 },
    { groupId: 8, carrierId: 1, lineOfBusinessId: 2, paidMonth: "2026-09", coverageMonth: null, grossCommissionCents: 375 },
  ];

  it("answers paid month and coverage month separately for Group + Carrier + LOB", () => {
    expect(coverageReceiptsFor(rows, 29, 3, 2)).toEqual([
      { coverageMonth: "2026-07", paidMonth: "2026-09", grossCommissionCents: 35196 },
    ]);
  });

  it("flags null coverage months as a missing-commission data limitation", () => {
    const readiness = missingCommissionDataReadiness(rows);
    expect(readiness.canAnswerPaidMonthReceipt).toBe(true);
    expect(readiness.canAnswerCoverageMonthReceipt).toBe(false);
    expect(readiness.missingCoverageMonthCount).toBe(1);
    expect(readiness.limitation).toMatch(/coverage\/source month/i);
  });
});
