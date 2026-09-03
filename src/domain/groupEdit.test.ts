import { describe, expect, it } from "vitest";
import { bulkAssignmentSummary, normalizeBulkGroupAssignment } from "./groupBulk";
import { groupEditDraftFrom, groupEditTitle } from "./groupEdit";

describe("group bulk assignment", () => {
  it("selects distinct groups and can change account manager and primary agent independently", () => {
    const both = normalizeBulkGroupAssignment({
      groupIds: [1, 2, 2, 3],
      accountManagerId: 9,
      primaryAgentId: 4,
    });
    expect(both.groupIds).toEqual([1, 2, 3]);
    expect(both.hasManager).toBe(true);
    expect(both.hasAgent).toBe(true);
    expect(bulkAssignmentSummary(both, { accountManagerName: "Laura Montoya", primaryAgentName: "John Elizando" }))
      .toBe("3 groups selected · Account Manager: Laura Montoya · Primary Agent: John Elizando");

    const managerOnly = normalizeBulkGroupAssignment({ groupIds: [8], accountManagerId: null });
    expect(managerOnly.hasManager).toBe(true);
    expect(managerOnly.hasAgent).toBe(false);
    expect(managerOnly.accountManagerId).toBeNull();
  });

  it("rejects an empty selection or a bulk action with no assignment fields", () => {
    expect(() => normalizeBulkGroupAssignment({ groupIds: [] })).toThrow(/at least one group/);
    expect(() => normalizeBulkGroupAssignment({ groupIds: [1] })).toThrow(/account manager, a primary agent, or both/);
  });
});

describe("group edit state", () => {
  it("creates an explicit edit draft from the current group without mutating it", () => {
    const group = {
      id: 12,
      name: "H R LABOR CONTRACTING",
      groupNumber: "HR1",
      accountManagerId: 2,
      primaryAgentId: 5,
      notes: "Medical",
    };
    const draft = groupEditDraftFrom(group);
    expect(groupEditTitle(draft.name)).toBe("Editing: H R LABOR CONTRACTING");
    expect(draft).toMatchObject({
      id: 12,
      name: "H R LABOR CONTRACTING",
      groupNumber: "HR1",
      accountManagerId: "2",
      primaryAgentId: "5",
      notes: "Medical",
    });
    draft.name = "Changed";
    expect(group.name).toBe("H R LABOR CONTRACTING");
  });
});
