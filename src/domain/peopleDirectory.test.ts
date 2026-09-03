import { describe, expect, it } from "vitest";
import { buildPeopleDirectory, filterPeopleDirectory, personRoleLabel } from "./peopleDirectory";

describe("people directory", () => {
  it("does not merge different role records merely because their names match", () => {
    const people = buildPeopleDirectory({
      agents: [{ id: 1, name: "Alex Morgan" }],
      accountManagers: [{ id: 9, name: "alex morgan" }],
      groups: [
        { name: "Acme Benefits", primaryAgentId: 1, accountManagerId: 9 },
        { name: "Beta Co", primaryAgentId: null, accountManagerId: 9 },
      ],
    });
    expect(people).toHaveLength(2);
    expect(people.map((person) => person.roles)).toEqual([["account_manager"], ["agent"]]);
    expect(people.map((person) => personRoleLabel(person.roles))).toEqual(["Account manager", "Agent"]);
    expect(people.map((person) => person.groupNames)).toEqual([["Acme Benefits", "Beta Co"], ["Acme Benefits"]]);
  });

  it("does not treat account manager assignment as compensation eligibility", () => {
    const people = buildPeopleDirectory({
      agents: [],
      accountManagers: [{ id: 3, name: "Jordan Lee" }],
      groups: [{ name: "Acme Benefits", primaryAgentId: null, accountManagerId: 3 }],
    });
    expect(people[0]?.roles).toEqual(["account_manager"]);
    expect(people[0]?.agentId).toBeNull();
  });

  it("filters by role and search text", () => {
    const people = buildPeopleDirectory({
      agents: [{ id: 1, name: "Alex Morgan" }],
      accountManagers: [{ id: 2, name: "Jordan Lee" }],
      groups: [{ name: "Acme Benefits", primaryAgentId: 1, accountManagerId: 2 }],
    });
    expect(filterPeopleDirectory(people, "acme", "all")).toHaveLength(2);
    expect(filterPeopleDirectory(people, "", "agent").map((row) => row.name)).toEqual(["Alex Morgan"]);
  });
});
