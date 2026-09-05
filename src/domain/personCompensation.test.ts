import { describe, expect, it } from "vitest";
import { editAllocationHref, personCompensationPeriod, personCompensationRows } from "./personCompensation";

const allocation = {
  id: 44,
  groupId: 1,
  groupName: "Fresno Heating & Cooling",
  lineOfBusinessId: 8,
  lineOfBusinessName: "Life",
  effectiveStart: "2026-09",
  effectiveEnd: null as string | null,
  status: "active" as const,
  entries: [
    { recipientType: "person" as const, personKind: "agent" as const, personId: 1, teamId: null, teamName: null, compensationBps: 7000 },
    { recipientType: "person" as const, personKind: "account_manager" as const, personId: 9, teamId: null, teamName: null, compensationBps: 500 },
    { recipientType: "team" as const, personKind: null, personId: null, teamId: 3, teamName: "Central Valley", compensationBps: 2500 },
  ],
};

describe("person compensation relationships", () => {
  it("lists the person's Group + LOB splits from existing allocations", () => {
    const rows = personCompensationRows({
      allocations: [allocation],
      personKind: "account_manager",
      personId: 9,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      allocationId: 44,
      groupName: "Fresno Heating & Cooling",
      lineOfBusinessName: "Life",
      roleLabel: "Account manager",
      allocationBps: 500,
      effectiveStart: "2026-09",
      status: "active",
    });
    expect(personCompensationPeriod(rows[0]!)).toBe("Sep 2026 →");
    expect(editAllocationHref(44)).toBe("/compensation?allocationId=44");
  });

  it("includes team-member relationships without inventing a second compensation system", () => {
    const rows = personCompensationRows({
      allocations: [allocation],
      teams: [{
        id: 3,
        name: "Central Valley",
        members: [
          { personKind: "agent", personId: 2, shareBps: 4000, status: "active" },
          { personKind: "account_manager", personId: 9, shareBps: 6000, status: "active" },
        ],
      }],
      personKind: "account_manager",
      personId: 9,
    });
    expect(rows.map((row) => row.roleLabel)).toEqual(["Account manager", "Team member"]);
    expect(rows.find((row) => row.recipientType === "team_member")?.allocationBps).toBe(1500);
  });
});
