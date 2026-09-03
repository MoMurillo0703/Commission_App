import { describe, expect, it } from "vitest";
import { applyGroupResolutions, detectGroupHeaders, findNormalizedGroup, matchImportedGroup } from "./groupMatch";

const groups = [
  { id: 1, name: "Acme Benefits", groupNumber: "A1" },
  { id: 2, name: "Beta Co", groupNumber: null },
];

describe("imported group matching", () => {
  it("matches an existing group by number or name and leaves unknown groups unmatched", () => {
    expect(matchImportedGroup(groups, "Other", "A1")).toMatchObject({ status: "ambiguous", groupId: null });
    expect(matchImportedGroup(groups, "beta co", null)).toMatchObject({ status: "matched", groupId: 2 });
    expect(matchImportedGroup(groups, "Empower Speech", "ES-9")).toMatchObject({
      status: "new_group",
      groupId: null,
      sourceName: "Empower Speech",
      sourceNumber: "ES-9",
    });
    expect(matchImportedGroup(groups, "  ", "")).toMatchObject({ status: "missing", groupId: null });
    expect(matchImportedGroup(groups, "  ACME   BENEFITS ", null)).toMatchObject({ status: "matched", groupId: 1 });
    expect(findNormalizedGroup(groups, "acme   benefits", null)?.id).toBe(1);
  });

  it("applies a confirmed match to an existing group without merging other groups", () => {
    const unmatched = matchImportedGroup(groups, "Empower Speech", "ES-9");
    expect(applyGroupResolutions(unmatched, [{ key: "name:empower speech|number:es-9", groupId: 2, sourceName: "Empower Speech", sourceNumber: "ES-9" }], groups)).toMatchObject({
      status: "matched",
      groupId: 2,
      groupName: "Beta Co",
    });
    expect(applyGroupResolutions(unmatched, undefined, groups).status).toBe("new_group");
    const nowMatchesAnotherGroup = matchImportedGroup(groups, "Beta Co", null);
    expect(applyGroupResolutions(nowMatchesAnotherGroup, [{ key: "name:beta co", groupId: 1, sourceName: "Beta Co", sourceNumber: null }], groups)).toMatchObject({
      status: "matched",
      groupId: 1,
      groupName: "Acme Benefits",
    });
  });

  it("requires review for duplicate or contradictory identities", () => {
    const candidates = [
      { id: 1, name: "Acme", groupNumber: "A1" },
      { id: 2, name: "Acme", groupNumber: "A2" },
      { id: 3, name: "Beta", groupNumber: "B1" },
      { id: 4, name: "Gamma", groupNumber: "B1" },
    ];
    expect(matchImportedGroup(candidates, "Acme", null).status).toBe("ambiguous");
    expect(matchImportedGroup(candidates, null, "B1").status).toBe("ambiguous");
    expect(matchImportedGroup(candidates, "Acme", "B1").status).toBe("ambiguous");
    expect(matchImportedGroup(candidates, "Acme", "A2")).toMatchObject({ status: "matched", groupId: 2 });
  });

  it("detects group and premium-month columns without treating premium month as the paid month", () => {
    expect(detectGroupHeaders(["Group Name", "Group Number", "Premium Month", "Commission"])).toEqual({
      groupNameHeader: "Group Name",
      groupNumberHeader: "Group Number",
      premiumMonthHeader: "Premium Month",
    });
    expect(detectGroupHeaders(["NAME / GROUP NAME", "POLICY NUMBER", "DUE DATE"])).toEqual({
      groupNameHeader: "NAME / GROUP NAME",
      groupNumberHeader: "POLICY NUMBER",
      premiumMonthHeader: "DUE DATE",
    });
  });
});
