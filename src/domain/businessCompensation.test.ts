import { describe, expect, it } from "vitest";
import { AGENCY_OWNER_LABEL } from "./agencyOwner";
import {
  agencyOwnerDrilldown,
  businessAllocationShares,
  classifyBusinessPayout,
  classifyCompensationGroups,
  drilldownPayableTotals,
  filterCompensationGroupClass,
  moAgencyCentsFromBuckets,
  reconcilePostedCommissions,
} from "./businessCompensation";
import { isEligibleAgencyFallback } from "./compensationFallback";

const mo = { personKind: "agent" as const, personId: 2 };
const john = { personKind: "agent" as const, personId: 1, label: "John Elizondo" };
const laura = { personKind: "account_manager" as const, personId: 1, label: "Laura Montoya" };
const nancy = { personKind: "account_manager" as const, personId: 2, label: "Nancy Guerra" };
const named = [john, laura, nancy];
const calChoiceTeam = {
  id: 1,
  members: [
    { personKind: "agent" as const, personId: 1, shareBps: 7000, effectiveStart: "2026-09", effectiveEnd: null },
    { personKind: "agent" as const, personId: 2, shareBps: 2000, effectiveStart: "2026-09", effectiveEnd: null },
    { personKind: "account_manager" as const, personId: 1, shareBps: 500, effectiveStart: "2026-09", effectiveEnd: null },
    { personKind: "account_manager" as const, personId: 2, shareBps: 500, effectiveStart: "2026-09", effectiveEnd: null },
  ],
};

const genuineFallbackPayouts = [{
  recipientType: "agency" as const,
  allocationId: null,
  allocationBps: 10000,
  compensationCents: 8000,
}];

describe("Mo / Agency business presentation", () => {
  it("does not count Mo twice on a Cal Choice Team allocation", () => {
    const shares = businessAllocationShares({
      entries: [{ recipientType: "team", teamId: 1, compensationBps: 10000 }],
      teams: [calChoiceTeam],
      owner: mo,
      namedPeople: named,
      paidMonth: "2026-09",
    });
    expect(shares).toMatchObject({
      moAgencyBps: 2000,
      namedBps: { "agent:1": 7000, "account_manager:1": 500, "account_manager:2": 500 },
      otherBps: 0,
      totalBps: 10000,
      mixedTeamVersions: false,
    });
  });

  it("shows Mo 100% as Mo / Agency and keeps Agency remainder zero on a team split", () => {
    expect(businessAllocationShares({
      entries: [{ recipientType: "person", personKind: "agent", personId: 2, compensationBps: 10000 }],
      teams: [],
      owner: mo,
      namedPeople: named,
      paidMonth: "2026-09",
    }).moAgencyBps).toBe(10000);
    const team = businessAllocationShares({
      entries: [{ recipientType: "team", teamId: 1, compensationBps: 10000 }],
      teams: [calChoiceTeam],
      owner: mo,
      namedPeople: named,
      paidMonth: "2026-09",
    });
    expect(team.moAgencyBps + Object.values(team.namedBps).reduce((sum, bps) => sum + bps, 0)).toBe(10000);
  });

  it("rolls technical Agency-retained money into Mo / Agency once and does not treat null allocationId alone as fallback", () => {
    expect(moAgencyCentsFromBuckets({
      moDirectCents: 4522,
      moTeamCents: 10399,
      agencyRetainedCents: 800,
    })).toBe(15721);
    expect(classifyBusinessPayout({
      recipientType: "agency",
      allocationId: 55,
      compensationCents: 800,
    }, mo)).toBe("agency_retained");
    expect(classifyBusinessPayout({
      recipientType: "agency",
      allocationId: null,
      compensationCents: 126907,
    }, mo)).toBe("inconsistent_agency");
  });

  it("ignores team parents, classifies no-payout separately, and independently arrives at a $0 difference", () => {
    const report = reconcilePostedCommissions({
      paidMonth: "2026-09",
      owner: mo,
      namedPeople: named,
      commissions: [
        {
          id: 1,
          paidMonth: "2026-09",
          grossCommissionCents: 10000,
          agentCompensationCents: 10000,
          agencyNetCents: 0,
          payouts: [
            { recipientType: "team", compensationCents: 10000, allocationId: 1, allocationBps: 10000 },
            { recipientType: "team_member", personKind: "agent", personId: 1, compensationCents: 7000, allocationId: 1 },
            { recipientType: "team_member", personKind: "agent", personId: 2, compensationCents: 2000, allocationId: 1 },
            { recipientType: "team_member", personKind: "account_manager", personId: 1, compensationCents: 500, allocationId: 1 },
            { recipientType: "team_member", personKind: "account_manager", personId: 2, compensationCents: 500, allocationId: 1 },
          ],
        },
        {
          id: 2,
          paidMonth: "2026-09",
          grossCommissionCents: -1500,
          agentCompensationCents: -1500,
          agencyNetCents: 0,
          payouts: [
            { recipientType: "team", compensationCents: -1500, allocationId: 1, allocationBps: 10000 },
            { recipientType: "team_member", personKind: "agent", personId: 1, compensationCents: -1050, allocationId: 1 },
            { recipientType: "team_member", personKind: "agent", personId: 2, compensationCents: -300, allocationId: 1 },
            { recipientType: "team_member", personKind: "account_manager", personId: 1, compensationCents: -75, allocationId: 1 },
            { recipientType: "team_member", personKind: "account_manager", personId: 2, compensationCents: -75, allocationId: 1 },
          ],
        },
        {
          id: 3,
          paidMonth: "2026-09",
          grossCommissionCents: 4000,
          agentCompensationCents: 0,
          agencyNetCents: 4000,
          payouts: [],
        },
      ],
    });
    expect(report.moAgencyCents).toBe(1700);
    expect(report.namedCents["agent:1"]).toBe(5950);
    expect(report.namedCents["account_manager:1"]).toBe(425);
    expect(report.namedCents["account_manager:2"]).toBe(425);
    expect(report.legacyNoPayoutCents).toBe(4000);
    expect(report.legacyNoPayoutCount).toBe(1);
    expect(report.fallbackAgencyCents).toBe(0);
    expect(report.teamParentCents).toBe(8500);
    expect(report.accountedClassifiedTotalCents).toBe(report.grossCents);
    expect(report.differenceCents).toBe(0);
    expect(report.payableReady).toBe(false);
  });

  it("keeps groups without allocations visible and classifies filters", () => {
    const groups = classifyCompensationGroups({
      groups: [{ id: 1, name: "Needs Setup" }, { id: 2, name: "Configured Group" }],
      summaries: [{ groupId: 2, groupName: "Configured Group", activeAllocationCount: 2, currentLineNames: ["Medical"] }],
      missingLineCounts: { 1: 1 },
      exceptionGroupIds: [1],
    });
    expect(groups).toHaveLength(2);
    expect(filterCompensationGroupClass(groups, "all")).toHaveLength(2);
    expect(filterCompensationGroupClass(groups, "needs_compensation").map((group) => group.groupName)).toEqual(["Needs Setup"]);
    expect(filterCompensationGroupClass(groups, "configured").map((group) => group.groupName)).toEqual(["Configured Group"]);
    expect(filterCompensationGroupClass(groups, "historical_exceptions").map((group) => group.groupName)).toEqual(["Needs Setup"]);
  });

  it("proves Mo / Agency drilldown does not double-count team and Agency on the same dollars", () => {
    const lines = agencyOwnerDrilldown({
      owner: mo,
      commissions: [{
        id: 9,
        paidMonth: "2026-09",
        carrierName: "CaliforniaChoice",
        groupName: "JOSES ORNAMENTAL SUPPLY INC",
        lineOfBusinessName: "Medical",
        grossCommissionCents: 10000,
        payouts: [
          { recipientType: "team", compensationCents: 10000, allocationId: 1 },
          { recipientType: "team_member", personKind: "agent", personId: 2, compensationCents: 2000, allocationId: 1 },
          { recipientType: "team_member", personKind: "agent", personId: 1, compensationCents: 7000, allocationId: 1 },
          { recipientType: "team_member", personKind: "account_manager", personId: 1, compensationCents: 500, allocationId: 1 },
          { recipientType: "team_member", personKind: "account_manager", personId: 2, compensationCents: 500, allocationId: 1 },
        ],
      }],
    });
    expect(lines[0]).toMatchObject({
      moDirectCents: 0,
      moTeamCents: 2000,
      agencyRetainedCents: 0,
      moAgencyCents: 2000,
      otherCents: 8000,
      distributedCents: 10000,
      differenceCents: 0,
      settlementClass: "settled",
    });
    expect(AGENCY_OWNER_LABEL).toBe("Mo / Agency");
  });
});

describe("strict fallback and legacy no-payout classification", () => {
  it("does not classify Agency payout as fallback merely because allocation_id is null", () => {
    const report = reconcilePostedCommissions({
      paidMonth: "2026-09",
      owner: mo,
      namedPeople: named,
      commissions: [{
        id: 10,
        paidMonth: "2026-09",
        grossCommissionCents: 8000,
        agentCompensationCents: 5600,
        agencyNetCents: 2400,
        payouts: [
          { recipientType: "person", personKind: "agent", personId: 1, allocationId: null, allocationBps: 7000, compensationCents: 5600 },
          { recipientType: "agency", allocationId: null, allocationBps: 3000, compensationCents: 2400 },
        ],
      }],
    });
    expect(report.fallbackAgencyCents).toBe(0);
    expect(report.fallbackCommissionCount).toBe(0);
    expect(report.moAgencyCents).toBe(0);
    expect(report.inconsistentCents).toBe(2400);
    expect(report.namedCents["agent:1"]).toBe(5600);
    expect(report.payableReady).toBe(false);
  });

  it("classifies the complete 100% Agency fallback signature correctly", () => {
    const report = reconcilePostedCommissions({
      paidMonth: "2026-09",
      owner: mo,
      namedPeople: named,
      commissions: [{
        id: 11,
        paidMonth: "2026-09",
        grossCommissionCents: 8000,
        agentCompensationCents: 0,
        agencyNetCents: 8000,
        payouts: genuineFallbackPayouts,
      }],
    });
    expect(isEligibleAgencyFallback({
      commissionId: 11,
      grossCommissionCents: 8000,
      agentCompensationCents: 0,
      agencyNetCents: 8000,
      payouts: genuineFallbackPayouts,
      hasPriorCorrection: false,
    })).toBe(true);
    expect(report.fallbackAgencyCents).toBe(8000);
    expect(report.fallbackCommissionCount).toBe(1);
    expect(report.moAgencyCents).toBe(0);
    expect(report.payableReady).toBe(false);
    expect(report.payableReadyMessage).toMatch(/NOT PAYABLE-READY/);
  });

  it("classifies zero payout rows as LEGACY — NO PAYOUT SNAPSHOT and keeps them out of payable totals", () => {
    const report = reconcilePostedCommissions({
      paidMonth: "2026-09",
      owner: mo,
      namedPeople: named,
      commissions: [{
        id: 12,
        paidMonth: "2026-09",
        grossCommissionCents: 3333,
        agentCompensationCents: 3333,
        agencyNetCents: 0,
        payouts: [],
      }],
    });
    expect(report.legacyNoPayoutCount).toBe(1);
    expect(report.legacyNoPayoutCents).toBe(3333);
    expect(report.moAgencyCents).toBe(0);
    expect(report.fallbackAgencyCents).toBe(0);
    expect(report.agencyRetainedCents).toBe(0);
    expect(report.payableReady).toBe(false);
  });
});

describe("independent reconciliation difference", () => {
  it("surfaces under-distribution, over-distribution, and unclassified money without forcing difference to zero", () => {
    const under = reconcilePostedCommissions({
      paidMonth: "2026-09",
      owner: mo,
      namedPeople: named,
      commissions: [{
        id: 20,
        paidMonth: "2026-09",
        grossCommissionCents: 10000,
        agentCompensationCents: 7000,
        agencyNetCents: 3000,
        payouts: [
          { recipientType: "person", personKind: "agent", personId: 1, allocationId: 1, allocationBps: 7000, compensationCents: 7000 },
        ],
      }],
    });
    expect(under.namedCents["agent:1"]).toBe(7000);
    expect(under.underDistributedCents).toBe(3000);
    expect(under.accountedClassifiedTotalCents).toBe(7000);
    expect(under.differenceCents).toBe(3000);
    expect(under.payableReady).toBe(false);

    const over = reconcilePostedCommissions({
      paidMonth: "2026-09",
      owner: mo,
      namedPeople: named,
      commissions: [{
        id: 21,
        paidMonth: "2026-09",
        grossCommissionCents: 10000,
        agentCompensationCents: 10000,
        agencyNetCents: 0,
        payouts: [
          { recipientType: "person", personKind: "agent", personId: 1, allocationId: 1, allocationBps: 10000, compensationCents: 12000 },
        ],
      }],
    });
    expect(over.overDistributedCents).toBe(2000);
    expect(over.accountedClassifiedTotalCents).toBe(12000);
    expect(over.differenceCents).toBe(-2000);

    const clean = reconcilePostedCommissions({
      paidMonth: "2026-09",
      owner: mo,
      namedPeople: named,
      commissions: [{
        id: 22,
        paidMonth: "2026-09",
        grossCommissionCents: 10000,
        agentCompensationCents: 2000,
        agencyNetCents: 0,
        payouts: [
          { recipientType: "team", compensationCents: 10000, allocationId: 1 },
          { recipientType: "team_member", personKind: "agent", personId: 2, compensationCents: 2000, allocationId: 1 },
          { recipientType: "team_member", personKind: "agent", personId: 1, compensationCents: 8000, allocationId: 1 },
        ],
      }],
    });
    expect(clean.differenceCents).toBe(0);
    expect(clean.accountedClassifiedTotalCents).toBe(clean.grossCents);
    expect(clean.payableReady).toBe(true);
    expect(clean.payableReadyMessage).toBeNull();
  });
});

describe("report filters and header/detail consistency", () => {
  const commissions = [
    {
      id: 31,
      paidMonth: "2026-09",
      groupId: 1,
      carrierId: 10,
      lineOfBusinessId: 100,
      groupName: "Group A",
      carrierName: "Carrier A",
      lineOfBusinessName: "Medical",
      grossCommissionCents: 10000,
      agentCompensationCents: 2000,
      agencyNetCents: 0,
      payouts: [
        { recipientType: "person", personKind: "agent", personId: 2, allocationId: 1, compensationCents: 2000 },
        { recipientType: "person", personKind: "agent", personId: 1, allocationId: 1, compensationCents: 8000 },
      ],
    },
    {
      id: 32,
      paidMonth: "2026-09",
      groupId: 2,
      carrierId: 20,
      lineOfBusinessId: 200,
      groupName: "Group B",
      carrierName: "Carrier B",
      lineOfBusinessName: "Dental",
      grossCommissionCents: 4000,
      agentCompensationCents: 4000,
      agencyNetCents: 0,
      payouts: [
        { recipientType: "person", personKind: "agent", personId: 2, allocationId: 1, compensationCents: 4000 },
      ],
    },
  ];

  it("changes totals when Group, Carrier, or LOB filters change, and keeps header totals on the same dataset as detail", () => {
    const all = reconcilePostedCommissions({ paidMonth: "2026-09", owner: mo, namedPeople: named, commissions });
    const group = reconcilePostedCommissions({
      paidMonth: "2026-09",
      owner: mo,
      namedPeople: named,
      commissions,
      filters: { paidMonth: "2026-09", groupId: 1 },
    });
    const carrier = reconcilePostedCommissions({
      paidMonth: "2026-09",
      owner: mo,
      namedPeople: named,
      commissions,
      filters: { paidMonth: "2026-09", carrierId: 20 },
    });
    const lob = reconcilePostedCommissions({
      paidMonth: "2026-09",
      owner: mo,
      namedPeople: named,
      commissions,
      filters: { paidMonth: "2026-09", lineOfBusinessId: 100 },
    });
    expect(all.grossCents).toBe(14000);
    expect(all.moAgencyCents).toBe(6000);
    expect(group.grossCents).toBe(10000);
    expect(group.moAgencyCents).toBe(2000);
    expect(carrier.grossCents).toBe(4000);
    expect(carrier.moAgencyCents).toBe(4000);
    expect(lob.grossCents).toBe(10000);
    expect(lob.postedCommissionCount).toBe(1);

    const detail = agencyOwnerDrilldown({
      owner: mo,
      commissions,
      filters: { paidMonth: "2026-09", groupId: 1 },
    });
    const header = drilldownPayableTotals(detail);
    expect(header.grossCents).toBe(group.grossCents);
    expect(header.moAgencyCents).toBe(group.moAgencyCents);
  });
});

describe("team membership by paid month", () => {
  const versions = {
    id: 1,
    members: [
      ...calChoiceTeam.members,
      { personKind: "agent" as const, personId: 1, shareBps: 10000, effectiveStart: "2025-01", effectiveEnd: "2025-12" },
    ],
  };

  it("selects one effective membership version for the paid month and never combines versions", () => {
    const september = businessAllocationShares({
      entries: [{ recipientType: "team", teamId: 1, compensationBps: 10000 }],
      teams: [versions],
      owner: mo,
      namedPeople: named,
      paidMonth: "2026-09",
    });
    expect(september.moAgencyBps).toBe(2000);
    expect(september.totalBps).toBe(10000);
    expect(september.mixedTeamVersions).toBe(false);

    const mixed = businessAllocationShares({
      entries: [{ recipientType: "team", teamId: 1, compensationBps: 10000 }],
      teams: [versions],
      owner: mo,
      namedPeople: named,
      paidMonth: null,
    });
    expect(mixed.mixedTeamVersions).toBe(true);
    expect(mixed.needsPaidMonth).toBe(true);
    expect(mixed.moAgencyBps).toBe(0);
    expect(mixed.totalBps).toBe(0);
  });
});

describe("payable readiness", () => {
  it("is NOT PAYABLE-READY when fallback or no-payout snapshot remains", () => {
    expect(reconcilePostedCommissions({
      paidMonth: "2026-09",
      owner: mo,
      namedPeople: named,
      commissions: [{
        id: 40,
        paidMonth: "2026-09",
        grossCommissionCents: 8000,
        agentCompensationCents: 0,
        agencyNetCents: 8000,
        payouts: genuineFallbackPayouts,
      }],
    }).payableReady).toBe(false);
    expect(reconcilePostedCommissions({
      paidMonth: "2026-09",
      owner: mo,
      namedPeople: named,
      commissions: [{
        id: 41,
        paidMonth: "2026-09",
        grossCommissionCents: 500,
        agentCompensationCents: 0,
        agencyNetCents: 500,
        payouts: [],
      }],
    }).payableReady).toBe(false);
  });
});

describe("September-shaped independent classification", () => {
  it("reproduces the known production class totals without rewriting payouts", () => {
    const fallbacks = Array.from({ length: 12 }, (_, index) => ({
      id: 100 + index,
      paidMonth: "2026-09",
      grossCommissionCents: index === 11 ? 10575 + 7 : 10575,
      agentCompensationCents: 0,
      agencyNetCents: index === 11 ? 10575 + 7 : 10575,
      payouts: [{
        recipientType: "agency" as const,
        allocationId: null,
        allocationBps: 10000,
        compensationCents: index === 11 ? 10575 + 7 : 10575,
      }],
    }));
    const noPayouts = [
      ...Array.from({ length: 46 }, (_, index) => ({
        id: 200 + index,
        paidMonth: "2026-09",
        grossCommissionCents: 9712,
        agentCompensationCents: 0,
        agencyNetCents: 9712,
        payouts: [],
      })),
      {
        id: 247,
        paidMonth: "2026-09",
        grossCommissionCents: 9697,
        agentCompensationCents: 0,
        agencyNetCents: 9697,
        payouts: [],
      },
      {
        id: 248,
        paidMonth: "2026-09",
        grossCommissionCents: 3333,
        agentCompensationCents: 3333,
        agencyNetCents: 0,
        payouts: [],
      },
      {
        id: 249,
        paidMonth: "2026-09",
        grossCommissionCents: 0,
        agentCompensationCents: 0,
        agencyNetCents: 0,
        payouts: [],
      },
    ];
    const settled = [{
      id: 300,
      paidMonth: "2026-09",
      grossCommissionCents: 63284,
      agentCompensationCents: 63284,
      agencyNetCents: 0,
      payouts: [
        { recipientType: "team", compensationCents: 63284, allocationId: 1 },
        { recipientType: "person", personKind: "agent", personId: 2, compensationCents: 4522, allocationId: 1 },
        { recipientType: "team_member", personKind: "agent", personId: 2, compensationCents: 10399, allocationId: 1 },
        { recipientType: "team_member", personKind: "agent", personId: 1, compensationCents: 42040, allocationId: 1 },
        { recipientType: "team_member", personKind: "account_manager", personId: 1, compensationCents: 3163, allocationId: 1 },
        { recipientType: "team_member", personKind: "account_manager", personId: 2, compensationCents: 3160, allocationId: 1 },
      ],
    }];
    const report = reconcilePostedCommissions({
      paidMonth: "2026-09",
      owner: mo,
      namedPeople: named,
      commissions: [...fallbacks, ...noPayouts, ...settled],
    });
    expect(report.fallbackCommissionCount).toBe(12);
    expect(report.fallbackAgencyCents).toBe(126907);
    expect(report.legacyNoPayoutCount).toBe(49);
    expect(report.legacyNoPayoutCents).toBe(459782);
    expect(report.moAgencyCents).toBe(14921);
    expect(report.namedCents["agent:1"]).toBe(42040);
    expect(report.grossCents).toBe(649973);
    expect(report.differenceCents).toBe(0);
    expect(report.payableReady).toBe(false);
  });
});

describe("agency owner coverage for payable readiness", () => {
  const namedWithMo = [...named, { personKind: "agent" as const, personId: 2, label: "Mo Murillo" }];
  const settledMo = {
    id: 50,
    paidMonth: "2026-09",
    grossCommissionCents: 2000,
    agentCompensationCents: 2000,
    agencyNetCents: 0,
    payouts: [{
      recipientType: "person" as const,
      personKind: "agent" as const,
      personId: 2,
      allocationId: 1,
      allocationBps: 10000,
      compensationCents: 2000,
    }],
  };

  it("resolves a single month with owner coverage and stays payable-ready when settled", () => {
    const report = reconcilePostedCommissions({
      paidMonth: "2026-09",
      owner: mo,
      namedPeople: namedWithMo,
      commissions: [settledMo],
      ownerForPaidMonth: (month) => month === "2026-09" ? mo : null,
    });
    expect(report.moAgencyCents).toBe(2000);
    expect(report.otherCents).toBe(0);
    expect(report.missingOwnerMonths).toEqual([]);
    expect(report.payableReady).toBe(true);
  });

  it("is NOT PAYABLE-READY for a single month without owner coverage and keeps Mo out of Other", () => {
    const report = reconcilePostedCommissions({
      paidMonth: "2026-09",
      owner: null,
      namedPeople: namedWithMo,
      commissions: [settledMo],
      ownerForPaidMonth: () => null,
    });
    expect(report.moAgencyCents).toBe(0);
    expect(report.namedCents["agent:2"]).toBe(2000);
    expect(report.otherCents).toBe(0);
    expect(report.payableReady).toBe(false);
    expect(report.missingOwnerMonths).toEqual(["2026-09"]);
    expect(report.payableReadyMessage).toMatch(/Agency owner is not configured for September 2026/);
  });

  it("allows a complete multi-month range and rejects a range or YTD with one uncovered month", () => {
    const august = { ...settledMo, id: 51, paidMonth: "2026-08" };
    const covered = reconcilePostedCommissions({
      paidMonth: "",
      owner: null,
      namedPeople: namedWithMo,
      commissions: [august, settledMo],
      filters: { startMonth: "2026-08", endMonth: "2026-09" },
      ownerForPaidMonth: () => mo,
    });
    expect(covered.payableReady).toBe(true);
    expect(covered.moAgencyCents).toBe(4000);
    expect(covered.missingOwnerMonths).toEqual([]);

    const gap = reconcilePostedCommissions({
      paidMonth: "",
      owner: null,
      namedPeople: namedWithMo,
      commissions: [august, settledMo],
      filters: { startMonth: "2026-08", endMonth: "2026-09" },
      ownerForPaidMonth: (month) => month === "2026-09" ? mo : null,
    });
    expect(gap.payableReady).toBe(false);
    expect(gap.missingOwnerMonths).toEqual(["2026-08"]);
    expect(gap.namedCents["agent:2"]).toBe(2000);
    expect(gap.moAgencyCents).toBe(2000);
    expect(gap.otherCents).toBe(0);

    const ytd = reconcilePostedCommissions({
      paidMonth: "",
      owner: null,
      namedPeople: namedWithMo,
      commissions: [august, settledMo],
      filters: { startMonth: "2026-01", endMonth: "2026-09", ytd: true },
      ownerForPaidMonth: (month) => month === "2026-09" ? mo : null,
    });
    expect(ytd.payableReady).toBe(false);
    expect(ytd.missingOwnerMonths).toEqual(["2026-08"]);
    expect(ytd.payableReadyMessage).toMatch(/August 2026/);
  });
});
