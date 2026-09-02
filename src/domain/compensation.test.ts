import { describe, expect, it } from "vitest";
import { calculateAgencyNetCents, calculateAgentCompensationCents, settleCommission } from "./compensation";

describe("agency net calculation", () => {
  it("is gross commission minus agent compensation", () => {
    expect(calculateAgencyNetCents(50000, 20000)).toBe(30000);
    expect(calculateAgencyNetCents(101, 34)).toBe(67);
  });

  it("derives agent compensation from a simple percent split", () => {
    expect(calculateAgentCompensationCents(50000, 4000)).toBe(20000);
    expect(calculateAgentCompensationCents(0, 5000)).toBe(0);
    expect(calculateAgentCompensationCents(-50000, 4000)).toBe(-20000);
  });

  it("rounds fractional cents from the percent split", () => {
    expect(calculateAgentCompensationCents(101, 3333)).toBe(34);
  });

  it("settles gross, compensation, and agency net together", () => {
    expect(settleCommission(10000, 0)).toEqual({
      compensationBps: 0,
      agentCompensationCents: 0,
      agencyNetCents: 10000,
    });
    expect(settleCommission(10000, 10000)).toEqual({
      compensationBps: 10000,
      agentCompensationCents: 10000,
      agencyNetCents: 0,
    });
  });
});
