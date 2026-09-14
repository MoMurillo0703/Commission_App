import { describe, expect, it } from "vitest";
import type { AllocationCandidate } from "./allocations";
import {
  EARNINGS_REVIEW_REQUIRED,
  currentEarningsReadiness,
  evaluateIndividualEarnings,
  projectIndividualEarnings,
  projectTeamEarnings,
  resolveEarningsAllocation,
  settleCurrentCommissionEarnings,
} from "./currentEarnings";
import {
  classifyAllocationPeriod,
  currentAllocationsForGroup,
  futureAllocationsForGroup,
  historicalAllocationsForGroup,
} from "./compensationHome";

const john = { kind: "agent" as const, id: 1, name: "John Elizondo" };
const mo = { kind: "agent" as const, id: 2, name: "Mo Murillo" };
const laura = { kind: "account_manager" as const, id: 3, name: "Laura Montoya" };
const nancy = { kind: "account_manager" as const, id: 4, name: "Nancy" };

const names = {
  personName: (kind: "agent" | "account_manager", id: number) => {
    const person = [john, mo, laura, nancy].find((item) => item.kind === kind && item.id === id);
    return person?.name ?? "Person";
  },
};

const calChoiceTeam = {
  id: 10,
  name: "Cal Choice Team",
  members: [
    { personKind: john.kind, personId: john.id, name: john.name, shareBps: 7000, effectiveStart: "2026-08", effectiveEnd: null, status: "active" },
    { personKind: mo.kind, personId: mo.id, name: mo.name, shareBps: 2000, effectiveStart: "2026-08", effectiveEnd: null, status: "active" },
    { personKind: laura.kind, personId: laura.id, name: laura.name, shareBps: 500, effectiveStart: "2026-08", effectiveEnd: null, status: "active" },
    { personKind: nancy.kind, personId: nancy.id, name: nancy.name, shareBps: 500, effectiveStart: "2026-08", effectiveEnd: null, status: "active" },
  ],
};

function teamAllocation(id: number, groupId: number, lineOfBusinessId: number, start: string, end: string | null = null): AllocationCandidate {
  return {
    id,
    groupId,
    lineOfBusinessId,
    effectiveStart: start,
    effectiveEnd: end,
    status: "active",
    entries: [{ recipientType: "team", teamId: calChoiceTeam.id, compensationBps: 10000 }],
  };
}

function commission(input: {
  id: number;
  paidMonth?: string;
  groupId?: number;
  lineOfBusinessId: number;
  lineOfBusinessName: string;
  grossCommissionCents: number;
  sourcePeriodLabel?: string | null;
  premiumMonth?: string | null;
}) {
  return {
    id: input.id,
    paidMonth: input.paidMonth ?? "2026-08",
    groupId: input.groupId ?? 1,
    groupName: "JOSES ORNAMENTAL SUPPLY INC",
    carrierId: 1,
    carrierName: "CaliforniaChoice",
    lineOfBusinessId: input.lineOfBusinessId,
    lineOfBusinessName: input.lineOfBusinessName,
    grossCommissionCents: input.grossCommissionCents,
    premiumMonth: input.premiumMonth ?? "2026-07",
    sourcePeriodLabel: input.sourcePeriodLabel ?? "07-26",
  };
}

const josesRows = [
  commission({ id: 1, lineOfBusinessId: 11, lineOfBusinessName: "Dental", grossCommissionCents: -2519 }),
  commission({ id: 2, lineOfBusinessId: 11, lineOfBusinessName: "Dental", grossCommissionCents: -2519 }),
  commission({ id: 3, lineOfBusinessId: 11, lineOfBusinessName: "Dental", grossCommissionCents: -2519 }),
  commission({ id: 4, lineOfBusinessId: 11, lineOfBusinessName: "Dental", grossCommissionCents: -2519 }),
  commission({ id: 5, lineOfBusinessId: 12, lineOfBusinessName: "Medical", grossCommissionCents: 62076 }),
  commission({ id: 6, lineOfBusinessId: 13, lineOfBusinessName: "Vision", grossCommissionCents: 936 }),
];

const augustAllocations = [
  teamAllocation(21, 1, 11, "2026-08"),
  teamAllocation(22, 1, 12, "2026-08"),
  teamAllocation(23, 1, 13, "2026-08"),
];

describe("current earnings projection", () => {
  it("settles the Joses six-row August fixture to John's $370.56", () => {
    const rows = projectIndividualEarnings({
      commissions: josesRows,
      allocations: augustAllocations,
      teams: [calChoiceTeam],
      names,
      personKind: "agent",
      personId: john.id,
    });
    expect(rows).toHaveLength(6);
    expect(rows.filter((row) => row.lineOfBusinessName === "Dental").map((row) => row.compensationCents)).toEqual([-1763, -1763, -1763, -1763]);
    expect(rows.find((row) => row.lineOfBusinessName === "Medical")?.compensationCents).toBe(43453);
    expect(rows.find((row) => row.lineOfBusinessName === "Vision")?.compensationCents).toBe(655);
    expect(rows.reduce((sum, row) => sum + row.compensationCents, 0)).toBe(37056);
  });

  it("defaults missing allocation to Agency 100% and does not fabricate John", () => {
    const resolved = resolveEarningsAllocation([], { groupId: 1, lineOfBusinessId: 12, paidMonth: "2026-08" });
    expect(resolved.defaultAgency).toBe(true);
    const rows = projectIndividualEarnings({
      commissions: [josesRows[4]!],
      allocations: [],
      teams: [calChoiceTeam],
      names,
      personKind: "agent",
      personId: john.id,
    });
    expect(rows).toHaveLength(0);
    const settled = settleCurrentCommissionEarnings({
      commission: josesRows[4]!,
      allocations: [],
      teams: [calChoiceTeam],
      names,
    });
    expect(settled.defaultAgency).toBe(true);
    expect(settled.settled?.payouts[0]?.recipientType).toBe("agency");
    expect(settled.settled?.payouts[0]?.compensationCents).toBe(62076);
  });

  it("treats explicit Agency 100% as configured Agency, still $0 for John", () => {
    const allocation: AllocationCandidate = {
      id: 90,
      groupId: 1,
      lineOfBusinessId: 12,
      effectiveStart: "2026-08",
      effectiveEnd: null,
      status: "active",
      entries: [{ recipientType: "agency", compensationBps: 10000 }],
    };
    const rows = projectIndividualEarnings({
      commissions: [josesRows[4]!],
      allocations: [allocation],
      teams: [calChoiceTeam],
      names,
      personKind: "agent",
      personId: john.id,
    });
    expect(rows).toHaveLength(0);
    expect(resolveEarningsAllocation([allocation], { groupId: 1, lineOfBusinessId: 12, paidMonth: "2026-08" }).defaultAgency).toBe(false);
  });

  it("never applies a September-effective allocation to August", () => {
    const future = [teamAllocation(31, 1, 11, "2026-09"), teamAllocation(32, 1, 12, "2026-09"), teamAllocation(33, 1, 13, "2026-09")];
    const rows = projectIndividualEarnings({
      commissions: josesRows,
      allocations: future,
      teams: [calChoiceTeam],
      names,
      personKind: "agent",
      personId: john.id,
    });
    expect(rows).toHaveLength(0);
  });

  it("ignores source/coverage period when selecting compensation", () => {
    const julySource = josesRows.map((row) => ({ ...row, premiumMonth: "2026-07", sourcePeriodLabel: "07-26" }));
    const septemberSource = josesRows.map((row) => ({ ...row, premiumMonth: "2026-09", sourcePeriodLabel: "09-26" }));
    const johnFrom = (commissions: typeof josesRows) => projectIndividualEarnings({
      commissions,
      allocations: augustAllocations,
      teams: [calChoiceTeam],
      names,
      personKind: "agent",
      personId: john.id,
    }).reduce((sum, row) => sum + row.compensationCents, 0);
    expect(johnFrom(julySource)).toBe(37056);
    expect(johnFrom(septemberSource)).toBe(37056);
  });

  it("selects the allocation and Team version that cover the Paid Month", () => {
    const versionedTeam = {
      ...calChoiceTeam,
      members: [
        ...calChoiceTeam.members.map((member) => ({ ...member, effectiveStart: "2026-08", effectiveEnd: "2026-08" })),
        { personKind: john.kind, personId: john.id, name: john.name, shareBps: 10000, effectiveStart: "2026-09", effectiveEnd: null, status: "active" },
      ],
    };
    const allocations = [
      teamAllocation(41, 1, 12, "2026-08", "2026-08"),
      teamAllocation(42, 1, 12, "2026-09"),
    ];
    const august = settleCurrentCommissionEarnings({
      commission: { ...josesRows[4]!, paidMonth: "2026-08" },
      allocations,
      teams: [versionedTeam],
      names,
    });
    const september = settleCurrentCommissionEarnings({
      commission: { ...josesRows[4]!, paidMonth: "2026-09", id: 50 },
      allocations,
      teams: [versionedTeam],
      names,
    });
    expect(august.settled?.payouts.find((payout) => payout.personId === john.id)?.compensationCents).toBe(43453);
    expect(september.settled?.payouts.find((payout) => payout.personId === john.id)?.compensationCents).toBe(62076);
  });

  it("calculates signed chargebacks and mixed direct + Team leaves without Team-parent double count", () => {
    const mixed: AllocationCandidate = {
      id: 51,
      groupId: 1,
      lineOfBusinessId: 12,
      effectiveStart: "2026-08",
      effectiveEnd: null,
      status: "active",
      entries: [
        { recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 5000 },
        { recipientType: "team", teamId: calChoiceTeam.id, compensationBps: 5000 },
      ],
    };
    const commissionRow = commission({ id: 80, lineOfBusinessId: 12, lineOfBusinessName: "Medical", grossCommissionCents: -10000 });
    const individual = projectIndividualEarnings({
      commissions: [commissionRow],
      allocations: [mixed],
      teams: [calChoiceTeam],
      names,
    });
    const team = projectTeamEarnings({
      commissions: [commissionRow],
      allocations: [mixed],
      teams: [calChoiceTeam],
      names,
      teamId: calChoiceTeam.id,
    });
    expect(individual.filter((row) => row.personId === john.id)).toHaveLength(2);
    expect(individual.some((row) => row.recipientType === "team")).toBe(false);
    expect(individual.reduce((sum, row) => sum + row.compensationCents, 0)).toBe(-10000);
    expect(team.reduce((sum, row) => sum + row.memberCompensationCents, 0)).toBe(-5000);
    expect(new Set(team.map((row) => row.snapshotKey)).size).toBe(1);
  });

  it("ignores inactive covering allocations and does not treat them as conflicts", () => {
    const inactive: AllocationCandidate = {
      id: 61,
      groupId: 1,
      lineOfBusinessId: 12,
      effectiveStart: "2026-08",
      effectiveEnd: null,
      status: "inactive",
      entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }],
    };
    expect(resolveEarningsAllocation([inactive], { groupId: 1, lineOfBusinessId: 12, paidMonth: "2026-08" })).toMatchObject({
      defaultAgency: true,
      reviewReason: null,
    });
    expect(projectIndividualEarnings({
      commissions: [josesRows[4]!],
      allocations: [inactive],
      teams: [calChoiceTeam],
      names,
      personKind: "agent",
      personId: john.id,
    })).toHaveLength(0);
    const active = teamAllocation(62, 1, 12, "2026-08");
    expect(resolveEarningsAllocation([inactive, active], { groupId: 1, lineOfBusinessId: 12, paidMonth: "2026-08" })).toMatchObject({
      allocation: { id: 62 },
      defaultAgency: false,
      reviewReason: null,
    });
  });

  it("surfaces REVIEW REQUIRED for incomplete active allocations, active conflicts, and invalid Team membership", () => {
    const incomplete: AllocationCandidate = {
      id: 61,
      groupId: 1,
      lineOfBusinessId: 12,
      effectiveStart: "2026-08",
      effectiveEnd: null,
      status: "active",
      entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 7000 }],
    };
    const conflictA = teamAllocation(62, 1, 11, "2026-08");
    const conflictB = teamAllocation(63, 1, 11, "2026-07");
    const futureTeam = {
      ...calChoiceTeam,
      members: calChoiceTeam.members.map((member) => ({ ...member, effectiveStart: "2026-09" })),
    };
    expect(projectIndividualEarnings({
      commissions: [josesRows[4]!],
      allocations: [incomplete],
      teams: [calChoiceTeam],
      names,
      personKind: "agent",
      personId: john.id,
    })[0]).toMatchObject({
      reviewRequired: true,
      reviewReason: "allocation does not total 100%",
      recipientName: EARNINGS_REVIEW_REQUIRED,
    });
    expect(resolveEarningsAllocation([conflictA, conflictB], { groupId: 1, lineOfBusinessId: 11, paidMonth: "2026-08" }).reviewReason)
      .toBe("conflicting effective allocation periods");
    expect(settleCurrentCommissionEarnings({
      commission: josesRows[4]!,
      allocations: [teamAllocation(64, 1, 12, "2026-08")],
      teams: [futureTeam],
      names,
    }).reviewReason).toBe("Team has invalid effective membership");
  });

  it("lets REVIEW REQUIRED win over legitimate-zero and payable-ready", () => {
    const evaluated = evaluateIndividualEarnings({
      commissions: [josesRows[4]!, josesRows[5]!],
      allocations: [{
        id: 70,
        groupId: 1,
        lineOfBusinessId: 12,
        effectiveStart: "2026-08",
        effectiveEnd: null,
        status: "active",
        entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 7000 }],
      }, teamAllocation(71, 1, 13, "2026-08")],
      teams: [calChoiceTeam],
      names,
      personKind: "agent",
      personId: john.id,
    });
    expect(evaluated.rows.some((row) => row.reviewRequired)).toBe(true);
    expect(evaluated.rows.some((row) => row.lineOfBusinessName === "Vision" && row.compensationCents === 655)).toBe(true);
    const readiness = currentEarningsReadiness({
      matchingCommissionCount: 2,
      outcomes: evaluated.outcomes,
      recipientRowCount: evaluated.rows.filter((row) => !row.reviewRequired).length,
    });
    expect(readiness.kind).toBe("review_required");
    expect(readiness.payableReady).toBe(false);
    expect(readiness.showTotals).toBe(true);
  });

  it("classifies current, future, and history from the as-of Paid Month and active status", () => {
    const allocations = [
      {
        id: 1,
        groupId: 10,
        groupName: "Joses",
        lineOfBusinessId: 1,
        lineOfBusinessName: "Dental",
        effectiveStart: "2026-08",
        effectiveEnd: "2026-10",
        status: "active" as const,
        entries: [{ recipientType: "team", personName: null, teamName: "Cal Choice Team", compensationBps: 10000 }],
      },
      {
        id: 2,
        groupId: 10,
        groupName: "Joses",
        lineOfBusinessId: 1,
        lineOfBusinessName: "Dental",
        effectiveStart: "2026-11",
        effectiveEnd: null,
        status: "active" as const,
        entries: [{ recipientType: "agency", personName: "Agency", teamName: null, compensationBps: 10000 }],
      },
      {
        id: 3,
        groupId: 10,
        groupName: "Joses",
        lineOfBusinessId: 1,
        lineOfBusinessName: "Dental",
        effectiveStart: "2026-01",
        effectiveEnd: "2026-07",
        status: "active" as const,
        entries: [{ recipientType: "agency", personName: "Agency", teamName: null, compensationBps: 10000 }],
      },
      {
        id: 4,
        groupId: 10,
        groupName: "Joses",
        lineOfBusinessId: 1,
        lineOfBusinessName: "Dental",
        effectiveStart: "2026-08",
        effectiveEnd: "2026-10",
        status: "inactive" as const,
        entries: [{ recipientType: "person", personName: "John", teamName: null, compensationBps: 10000 }],
      },
    ];
    expect(currentAllocationsForGroup(allocations, 10, "2026-08").map((row) => row.id)).toEqual([1]);
    expect(futureAllocationsForGroup(allocations, 10, "2026-08").map((row) => row.id)).toEqual([2]);
    expect(historicalAllocationsForGroup(allocations, 10, "2026-08").map((row) => row.id).sort()).toEqual([3, 4]);
    expect(classifyAllocationPeriod(allocations[3]!, "2026-08")).toBe("history");
    expect(currentAllocationsForGroup(allocations, 10, "2026-09").map((row) => row.id)).toEqual([1]);
    expect(historicalAllocationsForGroup(allocations, 10, "2026-09").map((row) => row.id)).not.toContain(2);
    expect(currentAllocationsForGroup(allocations, 10, "2026-11").map((row) => row.id)).toEqual([2]);
  });

  it("defaults missing allocation to Mo 100% when the effective owner is present", () => {
    const owner = { personKind: "agent" as const, personId: mo.id };
    const rows = projectIndividualEarnings({
      commissions: [josesRows[4]!],
      allocations: [],
      teams: [],
      names,
      agencyOwner: owner,
      personKind: "agent",
      personId: mo.id,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recipientName: "Mo",
      compensationCents: 62076,
      allocationBps: 10000,
    });
    expect(rows.some((row) => row.recipientName === "Agency")).toBe(false);
    expect(projectIndividualEarnings({
      commissions: [josesRows[4]!],
      allocations: [],
      teams: [],
      names,
      agencyOwner: owner,
      personKind: "agent",
      personId: john.id,
    })).toHaveLength(0);
  });

  it("requires review when a person-filtered report has no Agency owner", () => {
    const evaluated = evaluateIndividualEarnings({
      commissions: [josesRows[4]!],
      allocations: [],
      teams: [],
      names,
      agencyOwner: null,
      personKind: "agent",
      personId: john.id,
    });
    expect(evaluated.rows).toHaveLength(1);
    expect(evaluated.rows[0]).toMatchObject({
      reviewRequired: true,
      reviewReason: "Agency owner is not configured",
      recipientName: EARNINGS_REVIEW_REQUIRED,
      compensationCents: 0,
    });
    expect(evaluated.outcomes[0]?.kind).toBe("review_required");
    expect(currentEarningsReadiness({
      matchingCommissionCount: 1,
      outcomes: evaluated.outcomes,
      recipientRowCount: evaluated.rows.filter((row) => !row.reviewRequired).length,
    }).payableReady).toBe(false);
  });

  it("requires review when Agency owner coverage is missing or Mo is named twice", () => {
    expect(settleCurrentCommissionEarnings({
      commission: josesRows[4]!,
      allocations: [],
      teams: [],
      names,
      agencyOwner: null,
    }).reviewReason).toBe("Agency owner is not configured");
    expect(settleCurrentCommissionEarnings({
      commission: josesRows[4]!,
      allocations: [{
        id: 91,
        groupId: 1,
        lineOfBusinessId: 12,
        effectiveStart: "2026-08",
        effectiveEnd: null,
        status: "active",
        entries: [
          { recipientType: "agency", compensationBps: 5000 },
          { recipientType: "person", personKind: "agent", personId: mo.id, compensationBps: 5000 },
        ],
      }],
      teams: [],
      names,
      agencyOwner: { personKind: "agent", personId: mo.id },
    }).reviewReason).toBe("Mo is named twice as person and Agency");
    expect(settleCurrentCommissionEarnings({
      commission: josesRows[4]!,
      allocations: [{
        id: 92,
        groupId: 1,
        lineOfBusinessId: 12,
        effectiveStart: "2026-08",
        effectiveEnd: null,
        status: "active",
        entries: [
          { recipientType: "agency", compensationBps: 2000 },
          { recipientType: "team", teamId: calChoiceTeam.id, compensationBps: 8000 },
        ],
      }],
      teams: [calChoiceTeam],
      names,
      agencyOwner: { personKind: "agent", personId: mo.id },
    }).reviewReason).toBe("Mo is named twice as person and Agency");
    expect(settleCurrentCommissionEarnings({
      commission: josesRows[4]!,
      allocations: [{
        id: 93,
        groupId: 1,
        lineOfBusinessId: 12,
        effectiveStart: "2026-08",
        effectiveEnd: null,
        status: "active",
        entries: [{ recipientType: "agency", compensationBps: 10000 }],
      }],
      teams: [],
      names,
      agencyOwner: null,
    }).reviewReason).toBe("Agency owner is not configured");
  });

  it("resolves Agency owner per Paid Month across a YTD range", () => {
    const augustOwner = { personKind: "agent" as const, personId: mo.id };
    const septemberOwner = { personKind: "account_manager" as const, personId: laura.id };
    const rows = projectIndividualEarnings({
      commissions: [
        { ...josesRows[4]!, id: 201, paidMonth: "2026-08" },
        { ...josesRows[4]!, id: 202, paidMonth: "2026-09" },
      ],
      allocations: [],
      teams: [],
      names,
      ownerForPaidMonth: (month) => month === "2026-08" ? augustOwner : month === "2026-09" ? septemberOwner : null,
    });
    expect(rows.find((row) => row.paidMonth === "2026-08")).toMatchObject({
      recipientName: "Mo",
      personId: mo.id,
      compensationCents: 62076,
    });
    expect(rows.find((row) => row.paidMonth === "2026-09")).toMatchObject({
      recipientName: "Mo",
      personId: laura.id,
      compensationCents: 62076,
    });
  });

  it("requires review when multiple raw allocations collapse to the same canonical LOB", () => {
    const lines = [
      { id: 12, name: "Group Medical" },
      { id: 14, name: "MED" },
      { id: 15, name: "MEDHMO" },
    ];
    const resolved = resolveEarningsAllocation([
      {
        id: 1,
        groupId: 1,
        lineOfBusinessId: 14,
        effectiveStart: "2026-08",
        effectiveEnd: null,
        status: "active",
        entries: [{ recipientType: "agency", compensationBps: 10000 }],
      },
      {
        id: 2,
        groupId: 1,
        lineOfBusinessId: 15,
        effectiveStart: "2026-08",
        effectiveEnd: null,
        status: "active",
        entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }],
      },
    ], { groupId: 1, lineOfBusinessId: 12, paidMonth: "2026-08" }, lines);
    expect(resolved.reviewReason).toBe("conflicting effective allocation periods");
  });

  it("settles people-expanded 70/20/5/5 Joses terms to John's $370.56", () => {
    const peopleEntries = [
      { recipientType: "person" as const, personKind: "agent" as const, personId: john.id, compensationBps: 7000 },
      { recipientType: "agency" as const, compensationBps: 2000 },
      { recipientType: "person" as const, personKind: "account_manager" as const, personId: laura.id, compensationBps: 500 },
      { recipientType: "person" as const, personKind: "account_manager" as const, personId: nancy.id, compensationBps: 500 },
    ];
    const allocations = [
      { id: 81, groupId: 1, lineOfBusinessId: 11, effectiveStart: "2026-08", effectiveEnd: null, status: "active" as const, entries: peopleEntries },
      { id: 82, groupId: 1, lineOfBusinessId: 12, effectiveStart: "2026-08", effectiveEnd: null, status: "active" as const, entries: peopleEntries },
      { id: 83, groupId: 1, lineOfBusinessId: 13, effectiveStart: "2026-08", effectiveEnd: null, status: "active" as const, entries: peopleEntries },
    ];
    const rows = projectIndividualEarnings({
      commissions: josesRows,
      allocations,
      teams: [calChoiceTeam],
      names,
      personKind: "agent",
      personId: john.id,
      agencyOwner: { personKind: "agent", personId: mo.id },
    });
    expect(rows.reduce((sum, row) => sum + row.compensationCents, 0)).toBe(37056);
    const laterTeam = {
      ...calChoiceTeam,
      members: calChoiceTeam.members.map((member) => ({ ...member, shareBps: member.personId === john.id ? 10000 : 0 })).filter((member) => member.shareBps > 0),
    };
    expect(projectIndividualEarnings({
      commissions: josesRows,
      allocations,
      teams: [laterTeam],
      names,
      personKind: "agent",
      personId: john.id,
      agencyOwner: { personKind: "agent", personId: mo.id },
    }).reduce((sum, row) => sum + row.compensationCents, 0)).toBe(37056);
  });
});
