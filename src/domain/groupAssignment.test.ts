import { describe, expect, it } from "vitest";
import { groupHasSavedAssignments, partitionStatementGroupAssignments } from "./groupAssignment";

describe("statement group assignment work queue", () => {
  it("omits groups that already have both assignments and keeps incomplete rows for bulk save", () => {
    const groups = [
      { id: 1, name: "Already Set", accountManagerId: 4, primaryAgentId: 8 },
      { id: 2, name: "Needs AM", accountManagerId: null, primaryAgentId: 8 },
      { id: 3, name: "Needs both", accountManagerId: null, primaryAgentId: null },
    ];
    expect(groupHasSavedAssignments(groups[0]!)).toBe(true);
    expect(groupHasSavedAssignments(groups[1]!)).toBe(false);
    const { assigned, needsAssignment } = partitionStatementGroupAssignments(groups);
    expect(assigned.map((group) => group.id)).toEqual([1]);
    expect(needsAssignment.map((group) => group.id)).toEqual([2, 3]);
  });
});
