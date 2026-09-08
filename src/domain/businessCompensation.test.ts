import { describe, expect, it } from "vitest";
import { AGENCY_OWNER_LABEL } from "./agencyOwner";
import {
  agencyOwnerDrilldown,
  businessAllocationShares,
  classifyBusinessPayout,
  classifyCompensationGroups,
  filterCompensationGroupClass,
  moAgencyCentsFromBuckets,
  reconcilePostedCommissions,
} from "./businessCompensation";

const mo = { personKind: "agent" as const, personId: 2 };
const john = { personKind: "agent" as const, personId: 1, label: "John Elizondo" };
const laura = { personKind: "account_manager" as const, personId: 1, label: "Laura Montoya" };
const nancy = { personKind: "account_manager" as const, personId: 2, label: "Nancy Guerra" };
const named = [john, laura, nancy];
const calChoiceTeam = {
  id: 1,
  members: [
    { personKind: "agent" as const, personId: 1, shareBps: 7000 },
    { personKind: "agent" as const, personId: 2, shareBps: 2000 },
    { personKind: "account_manager" as const, personId: 1, shareBps: 500 },
    { personKind: "account_manager" as const, personId: 2, shareBps: 500 },
  ],
};

describe("Mo / Agency business presentation", () => {
  it("does not count Mo twice on a Cal Choice Team allocation", () => {
    const shares = businessAllocationShares({
      entries: [{ recipientType: "team", teamId: 1, compensationBps: 10000 }],
      teams: [calChoiceTeam],
      owner: mo,
      namedPeople: named,
    });
    expect(shares).toEqual({
      moAgencyBps: 2000,
      namedBps: { "agent:1": 7000, "account_manager:1": 500, "account_manager:2": 500 },
      otherBps: 0,
      totalBps: 10000,
    });
  });

  it("shows Mo 100% as Mo / Agency and keeps Agency remainder zero on a team split", () => {
    expect(businessAllocationShares({
      entries: [{ recipientType: "person", personKind: "agent", personId: 2, compensationBps: 10000 }],
      teams: [],
      owner: mo,
      namedPeople: named,
    }).moAgencyBps).toBe(10000);
    const team = businessAllocationShares({
      entries: [{ recipientType: "team", teamId: 1, compensationBps: 10000 }],
      teams: [calChoiceTeam],
      owner: mo,
      namedPeople: named,
    });
    expect(team.moAgencyBps + Object.values(team.namedBps).reduce((sum, bps) => sum + bps, 0)).toBe(10000);
  });

  it("rolls technical Agency-retained money into Mo / Agency once", () => {
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
    }, mo)).toBe("fallback_agency");
  });

  it("ignores team parents and reconciles positive and negative commissions", () => {
    const report = reconcilePostedCommissions({
      paidMonth: "2026-09",
      owner: mo,
      namedPeople: named,
      commissions: [
        {
          id: 1,
          paidMonth: "2026-09",
          grossCommissionCents: 10000,
          payouts: [
            { recipientType: "team", compensationCents: 10000 },
            { recipientType: "team_member", personKind: "agent", personId: 1, compensationCents: 7000 },
            { recipientType: "team_member", personKind: "agent", personId: 2, compensationCents: 2000 },
            { recipientType: "team_member", personKind: "account_manager", personId: 1, compensationCents: 500 },
            { recipientType: "team_member", personKind: "account_manager", personId: 2, compensationCents: 500 },
          ],
        },
        {
          id: 2,
          paidMonth: "2026-09",
          grossCommissionCents: -1500,
          payouts: [
            { recipientType: "team", compensationCents: -1500 },
            { recipientType: "team_member", personKind: "agent", personId: 1, compensationCents: -1050 },
            { recipientType: "team_member", personKind: "agent", personId: 2, compensationCents: -300 },
            { recipientType: "team_member", personKind: "account_manager", personId: 1, compensationCents: -75 },
            { recipientType: "team_member", personKind: "account_manager", personId: 2, compensationCents: -75 },
          ],
        },
        {
          id: 3,
          paidMonth: "2026-09",
          grossCommissionCents: 4000,
          payouts: [],
        },
      ],
    });
    expect(report.moAgencyCents).toBe(1700);
    expect(report.namedCents["agent:1"]).toBe(5950);
    expect(report.namedCents["account_manager:1"]).toBe(425);
    expect(report.namedCents["account_manager:2"]).toBe(425);
    expect(report.unresolvedCents).toBe(4000);
    expect(report.teamParentCents).toBe(8500);
    expect(report.accountedCents).toBe(report.grossCents);
    expect(report.differenceCents).toBe(0);
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
        paidMonth: "2026-09",
        carrierName: "CaliforniaChoice",
        groupName: "JOSES ORNAMENTAL SUPPLY INC",
        lineOfBusinessName: "Medical",
        grossCommissionCents: 10000,
        payouts: [
          { recipientType: "team", compensationCents: 10000 },
          { recipientType: "team_member", personKind: "agent", personId: 2, compensationCents: 2000 },
          { recipientType: "team_member", personKind: "agent", personId: 1, compensationCents: 7000 },
          { recipientType: "team_member", personKind: "account_manager", personId: 1, compensationCents: 500 },
          { recipientType: "team_member", personKind: "account_manager", personId: 2, compensationCents: 500 },
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
    });
    expect(AGENCY_OWNER_LABEL).toBe("Mo / Agency");
  });
});
