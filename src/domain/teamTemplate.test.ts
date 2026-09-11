import { describe, expect, it } from "vitest";
import { expandTeamTemplate, resolveTeamTemplateMembers } from "./teamTemplate";

const team = {
  id: 10,
  name: "Cal Choice Team",
  members: [
    { personKind: "agent" as const, personId: 1, shareBps: 7000, status: "active", effectiveStart: "2026-08", effectiveEnd: null },
    { personKind: "agent" as const, personId: 2, shareBps: 2000, status: "active", effectiveStart: "2026-08", effectiveEnd: null },
    { personKind: "account_manager" as const, personId: 3, shareBps: 500, status: "active", effectiveStart: "2026-08", effectiveEnd: null },
    { personKind: "account_manager" as const, personId: 4, shareBps: 500, status: "active", effectiveStart: "2026-08", effectiveEnd: null },
    { personKind: "agent" as const, personId: 9, shareBps: 10000, status: "active", effectiveStart: "2026-09", effectiveEnd: null },
  ],
};

describe("team templates", () => {
  it("resolves membership as of the effective month and expands people, not a Team recipient", () => {
    const entries = expandTeamTemplate({
      team,
      asOfMonth: "2026-08",
      owner: { personKind: "agent", personId: 2 },
    });
    expect(entries.some((entry) => entry.recipientType === "team")).toBe(false);
    expect(entries).toEqual([
      { recipientType: "person", personKind: "agent", personId: 1, compensationBps: 7000 },
      { recipientType: "agency", compensationBps: 2000 },
      { recipientType: "person", personKind: "account_manager", personId: 3, compensationBps: 500 },
      { recipientType: "person", personKind: "account_manager", personId: 4, compensationBps: 500 },
    ]);
    expect(resolveTeamTemplateMembers(team, "2026-08")).toHaveLength(4);
  });

  it("blocks invalid, overlapping, or incomplete template membership", () => {
    expect(() => expandTeamTemplate({
      team,
      asOfMonth: "2026-09",
      owner: { personKind: "agent", personId: 2 },
    })).toThrow();
    expect(() => expandTeamTemplate({
      team: { ...team, members: team.members.filter((member) => member.effectiveStart === "2026-08").map((member) => ({ ...member, shareBps: 2000 })) },
      asOfMonth: "2026-08",
      owner: { personKind: "agent", personId: 2 },
    })).toThrow();
  });
});
