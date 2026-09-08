import { describe, expect, it } from "vitest";
import { classifyAgencyFallback, classifyCorrectionSource, classifyLegacyNoPayout } from "./compensationFallback";

const genuine = {
  commissionId: 11,
  grossCommissionCents: 8000,
  agentCompensationCents: 0,
  agencyNetCents: 8000,
  payouts: [{
    recipientType: "agency" as const,
    allocationId: null,
    allocationBps: 10000,
    compensationCents: 8000,
  }],
  hasPriorCorrection: false,
};

describe("eligible Agency fallback classification", () => {
  it("accepts a genuine missing-allocation Agency 100% settlement, including chargebacks", () => {
    expect(classifyAgencyFallback(genuine).eligible).toBe(true);
    expect(classifyAgencyFallback({
      ...genuine,
      grossCommissionCents: -1500,
      agencyNetCents: -1500,
      payouts: [{ ...genuine.payouts[0]!, compensationCents: -1500 }],
    }).eligible).toBe(true);
  });

  it("rejects allocationId-null settlements that are not the Agency fallback", () => {
    expect(classifyAgencyFallback({
      ...genuine,
      payouts: [
        { recipientType: "person", allocationId: null, allocationBps: 7000, compensationCents: 5600 },
        { recipientType: "agency", allocationId: null, allocationBps: 3000, compensationCents: 2400 },
      ],
      agentCompensationCents: 5600,
      agencyNetCents: 2400,
    }).eligible).toBe(false);
    expect(classifyAgencyFallback({
      ...genuine,
      payouts: [{ ...genuine.payouts[0]!, allocationId: 44 }],
    }).eligible).toBe(false);
    expect(classifyAgencyFallback({
      ...genuine,
      payouts: [{ ...genuine.payouts[0]!, allocationBps: 7000, compensationCents: 5600 }],
      agentCompensationCents: 0,
      agencyNetCents: 8000,
    }).eligible).toBe(false);
    expect(classifyAgencyFallback({
      ...genuine,
      agentCompensationCents: 100,
      agencyNetCents: 7900,
    }).eligible).toBe(false);
    expect(classifyAgencyFallback({
      ...genuine,
      hasPriorCorrection: true,
    }).eligible).toBe(false);
    expect(classifyAgencyFallback({
      ...genuine,
      payouts: [],
    }).eligible).toBe(false);
  });
});

describe("legacy no-payout snapshot classification", () => {
  it("accepts commissions with zero payout rows and rejects payouts as not no-payout", () => {
    expect(classifyLegacyNoPayout({
      ...genuine,
      payouts: [],
    }).eligible).toBe(true);
    expect(classifyCorrectionSource({
      ...genuine,
      payouts: [],
    }).class).toBe("legacy_no_payout_snapshot");
    expect(classifyCorrectionSource(genuine).class).toBe("historical_agency_fallback");
    expect(classifyCorrectionSource({
      ...genuine,
      payouts: [
        { recipientType: "person", allocationId: null, allocationBps: 7000, compensationCents: 5600 },
        { recipientType: "agency", allocationId: null, allocationBps: 3000, compensationCents: 2400 },
      ],
      agentCompensationCents: 5600,
      agencyNetCents: 2400,
    }).class).toBe("not_eligible");
  });
});
