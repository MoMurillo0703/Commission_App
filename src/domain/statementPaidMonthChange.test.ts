import { describe, expect, it } from "vitest";
import { paidMonthAuditClassification, paidMonthBoundState, paidMonthPreviewToken } from "./statementPaidMonthChange";

function sampleCommission(id: number) {
  return {
    id,
    groupId: 1,
    carrierId: 2,
    lineOfBusinessId: 3,
    grossCommissionCents: 100,
    statementMonth: "2026-09",
    premiumMonth: "2026-08",
    sourceCoverageLabel: null,
    sourceGroupLabel: "Acme",
    sourceLobLabel: "Medical",
    sourcePeriodLabel: "08-26",
    sourceReference: null,
    sourceRowKey: `row-${id}`,
    importStatementId: 9,
    agentId: null,
    compensationBps: 10000,
    agentCompensationCents: 100,
    agencyNetCents: 0,
    corrected: false,
  };
}

describe("Change Paid Month bound state", () => {
  it("does not bind allocation or Team configuration", () => {
    const state = paidMonthBoundState({
      statementId: 9,
      currentPaidMonth: "2026-09",
      newPaidMonth: "2026-08",
      commissions: [sampleCommission(1)],
      payouts: [{
        id: 11,
        commissionId: 1,
        recipientType: "agency",
        allocationBps: 10000,
        compensationCents: 100,
        createdAt: "2026-09-01T00:00:00.000Z",
      }],
    });
    expect(state).not.toHaveProperty("allocations");
    expect(state).not.toHaveProperty("currentTeamMemberships");
    expect(state).not.toHaveProperty("proposedTeamMemberships");
    expect(JSON.stringify(state)).not.toMatch(/allocationTerms|teamMembership|shareBps/);
    expect(paidMonthPreviewToken(state)).toHaveLength(64);
  });

  it("records that financial snapshots are preserved with no payout correction", () => {
    expect(paidMonthAuditClassification({ payoutCount: 44 })).toEqual({
      financialSnapshotsPreserved: true,
      compensationRecalculation: "none",
      payoutCount: 44,
      payoutCorrectionRequired: false,
      payoutCorrectionPerformed: false,
    });
  });
});
