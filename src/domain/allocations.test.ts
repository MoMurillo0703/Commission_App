import { describe, expect, it } from "vitest";
import {
  allocationFromLegacyAgreement,
  allocationProgressLabel,
  allocationTotals,
  implicitAgencyAllocation,
  settleAllocation,
  validateAllocationEntries,
  validateTeamMemberShares,
} from "./allocations";

const names = {
  agencyName: "Murillo Insurance",
  personName: (_kind: "agent" | "account_manager", id: number) => {
    if (id === 1) return "John Elizando";
    if (id === 2) return "Laura Montoya";
    return "Nancy";
  },
};

describe("compensation allocations", () => {
  it("requires an exact 100 percent total and never fills the remainder", () => {
    const under = [
      { recipientType: "person" as const, personKind: "agent" as const, personId: 1, compensationBps: 7000 },
      { recipientType: "agency" as const, compensationBps: 1500 },
    ];
    expect(allocationTotals(under)).toMatchObject({ allocatedBps: 8500, remainingBps: 1500, complete: false });
    expect(allocationProgressLabel(under)).toMatch(/Allocated: 85% · Remaining: 15%/);
    expect(() => validateAllocationEntries(under)).toThrow(/exactly 100 percent/);

    const over = [...under, { recipientType: "person" as const, personKind: "account_manager" as const, personId: 2, compensationBps: 2000 }];
    expect(() => validateAllocationEntries(over)).toThrow(/cannot exceed 100 percent/);

    const complete = [
      { recipientType: "person" as const, personKind: "agent" as const, personId: 1, compensationBps: 7000 },
      { recipientType: "agency" as const, compensationBps: 2000 },
      { recipientType: "person" as const, personKind: "account_manager" as const, personId: 2, compensationBps: 500 },
      { recipientType: "person" as const, personKind: "agent" as const, personId: 3, compensationBps: 500 },
    ];
    expect(validateAllocationEntries(complete).complete).toBe(true);
    expect(allocationProgressLabel(complete)).toMatch(/Complete/);
  });

  it("allows Agency plus up to three people and rejects a fourth person or a duplicate recipient", () => {
    const fourPeople = [
      { recipientType: "person" as const, personKind: "agent" as const, personId: 1, compensationBps: 2500 },
      { recipientType: "person" as const, personKind: "agent" as const, personId: 2, compensationBps: 2500 },
      { recipientType: "person" as const, personKind: "agent" as const, personId: 3, compensationBps: 2500 },
      { recipientType: "person" as const, personKind: "agent" as const, personId: 4, compensationBps: 2500 },
    ];
    expect(() => validateAllocationEntries(fourPeople)).toThrow(/at most 3 individual people/);
    expect(() => validateAllocationEntries([
      { recipientType: "agency" as const, compensationBps: 5000 },
      { recipientType: "agency" as const, compensationBps: 5000 },
    ])).toThrow(/Agency share only once/);
    expect(() => validateAllocationEntries([
      { recipientType: "person" as const, personKind: "agent" as const, personId: 1, compensationBps: 5000 },
      { recipientType: "person" as const, personKind: "agent" as const, personId: 1, compensationBps: 5000 },
    ])).toThrow(/only once/);
  });

  it("settles Agency plus multiple people without double-counting Agency net", () => {
    const settled = settleAllocation(10000, [
      { recipientType: "person", personKind: "agent", personId: 1, compensationBps: 7000 },
      { recipientType: "agency", compensationBps: 2000 },
      { recipientType: "person", personKind: "account_manager", personId: 2, compensationBps: 500 },
      { recipientType: "person", personKind: "agent", personId: 3, compensationBps: 500 },
    ], new Map(), names);
    expect(settled.payouts.find((row) => row.personName === "John Elizando")?.compensationCents).toBe(7000);
    expect(settled.agencyNetCents).toBe(2000);
    expect(settled.compensationDistributedCents).toBe(8000);
    expect(settled.agencyNetCents + settled.compensationDistributedCents).toBe(10000);
  });

  it("distributes a Team share through member percentages and keeps a team total that must not be added again", () => {
    const teams = new Map([[10, {
      id: 10,
      name: "Central Valley Team",
      members: [
        { personKind: "account_manager" as const, personId: 2, name: "Laura", shareBps: 5000 },
        { personKind: "agent" as const, personId: 3, name: "Nancy", shareBps: 5000 },
      ],
    }]]);
    expect(validateTeamMemberShares(teams.get(10)!.members).complete).toBe(true);
    const settled = settleAllocation(10000, [
      { recipientType: "person", personKind: "agent", personId: 1, compensationBps: 8000 },
      { recipientType: "team", teamId: 10, compensationBps: 2000 },
    ], teams, names);
    const team = settled.payouts.find((row) => row.recipientType === "team");
    const laura = settled.payouts.find((row) => row.personName === "Laura");
    const nancy = settled.payouts.find((row) => row.personName === "Nancy");
    expect(team?.compensationCents).toBe(2000);
    expect(laura?.compensationCents).toBe(1000);
    expect(nancy?.compensationCents).toBe(1000);
    expect(settled.compensationDistributedCents).toBe(10000);
    expect(settled.agencyNetCents).toBe(0);
  });

  it("reconciles deterministic pennies for positive and negative commissions", () => {
    const entries = [
      { recipientType: "agency" as const, compensationBps: 3334 },
      { recipientType: "person" as const, personKind: "agent" as const, personId: 1, compensationBps: 3333 },
      { recipientType: "person" as const, personKind: "account_manager" as const, personId: 2, compensationBps: 3333 },
    ];
    const positive = settleAllocation(1, entries, new Map(), names);
    const negative = settleAllocation(-1, entries, new Map(), names);
    const leafTotal = (result: typeof positive) => result.payouts
      .filter((row) => row.recipientType === "agency" || row.recipientType === "person" || row.recipientType === "team_member")
      .reduce((sum, row) => sum + row.compensationCents, 0);
    expect(leafTotal(positive)).toBe(1);
    expect(leafTotal(negative)).toBe(-1);
    expect(settleAllocation(1, entries, new Map(), names)).toEqual(positive);
  });

  it("preserves only the known person share from a partial legacy agreement", () => {
    const entries = allocationFromLegacyAgreement(4000, { personKind: "agent", personId: 1, name: "John Elizando" });
    expect(entries).toEqual([
      { recipientType: "person", personKind: "agent", personId: 1, compensationBps: 4000 },
    ]);
    expect(() => validateAllocationEntries(entries)).toThrow(/exactly 100 percent/);
    expect(implicitAgencyAllocation(5000).agencyNetCents).toBe(5000);
  });
});
