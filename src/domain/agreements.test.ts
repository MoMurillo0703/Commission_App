import { describe, expect, it } from "vitest";
import { resolveCompensationAgreement } from "./agreements";
import { paidMonthInRange, paidMonthRangesOverlap, previousPaidMonth } from "./dates";

const medical = {
  id: 1,
  groupId: 10,
  agentId: 20,
  lineOfBusinessId: 30,
  compensationBps: 4000,
  effectiveStart: "2026-01",
  effectiveEnd: "2026-06",
  status: "active" as const,
};

const medicalNext = {
  ...medical,
  id: 2,
  compensationBps: 6000,
  effectiveStart: "2026-07",
  effectiveEnd: null,
};

const dental = {
  ...medical,
  id: 3,
  lineOfBusinessId: 31,
  compensationBps: 2500,
  effectiveStart: "2026-01",
  effectiveEnd: null,
};

describe("effective-dated compensation resolution", () => {
  it("selects the agreement for group, agent, line, and paid month", () => {
    const agreements = [medical, medicalNext, dental];
    expect(resolveCompensationAgreement(agreements, {
      groupId: 10,
      agentId: 20,
      lineOfBusinessId: 30,
      paidMonth: "2026-03",
    })?.compensationBps).toBe(4000);
    expect(resolveCompensationAgreement(agreements, {
      groupId: 10,
      agentId: 20,
      lineOfBusinessId: 30,
      paidMonth: "2026-07",
    })?.compensationBps).toBe(6000);
    expect(resolveCompensationAgreement(agreements, {
      groupId: 10,
      agentId: 20,
      lineOfBusinessId: 31,
      paidMonth: "2026-07",
    })?.compensationBps).toBe(2500);
  });

  it("does not resolve inactive agreements or other lines", () => {
    expect(resolveCompensationAgreement([{ ...medical, status: "inactive", effectiveEnd: null }], {
      groupId: 10,
      agentId: 20,
      lineOfBusinessId: 30,
      paidMonth: "2026-03",
    })).toBeNull();
    expect(resolveCompensationAgreement([medical], {
      groupId: 10,
      agentId: 20,
      lineOfBusinessId: 99,
      paidMonth: "2026-03",
    })).toBeNull();
  });

  it("treats paid-month ranges as inclusive and closes on the prior month", () => {
    expect(paidMonthInRange("2026-06", "2026-01", "2026-06")).toBe(true);
    expect(paidMonthInRange("2026-07", "2026-01", "2026-06")).toBe(false);
    expect(previousPaidMonth("2026-07")).toBe("2026-06");
    expect(previousPaidMonth("2026-01")).toBe("2025-12");
    expect(paidMonthRangesOverlap("2026-01", null, "2026-07", null)).toBe(true);
    expect(paidMonthRangesOverlap("2026-01", "2026-06", "2026-07", null)).toBe(false);
  });
});
