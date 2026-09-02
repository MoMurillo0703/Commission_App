import { describe, expect, it } from "vitest";
import { detectGroupHeaders, matchImportedGroup } from "./groupMatch";

const groups = [
  { id: 1, name: "Acme Benefits", groupNumber: "A1" },
  { id: 2, name: "Beta Co", groupNumber: null },
];

describe("imported group matching", () => {
  it("matches an existing group by number or name and leaves unknown groups unmatched", () => {
    expect(matchImportedGroup(groups, "Other", "A1")).toMatchObject({ status: "matched", groupId: 1 });
    expect(matchImportedGroup(groups, "beta co", null)).toMatchObject({ status: "matched", groupId: 2 });
    expect(matchImportedGroup(groups, "Empower Speech", "ES-9")).toMatchObject({
      status: "new_group",
      groupId: null,
      sourceName: "Empower Speech",
      sourceNumber: "ES-9",
    });
    expect(matchImportedGroup(groups, "  ", "")).toMatchObject({ status: "missing", groupId: null });
  });

  it("detects group and premium-month columns without treating premium month as the paid month", () => {
    expect(detectGroupHeaders(["Group Name", "Group Number", "Premium Month", "Commission"])).toEqual({
      groupNameHeader: "Group Name",
      groupNumberHeader: "Group Number",
      premiumMonthHeader: "Premium Month",
    });
  });
});
