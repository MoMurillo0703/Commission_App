import { describe, expect, it } from "vitest";
import {
  compensationGroupSummaries,
  currentAllocationsForGroup,
  filterCompensationGroups,
  groupActiveCountLabel,
  historicalAllocationsForGroup,
  missingLinesForGroup,
} from "./compensationHome";

const allocations = [
  {
    id: 1,
    groupId: 10,
    groupName: "Fresno Heating and Cooling",
    lineOfBusinessId: 1,
    lineOfBusinessName: "Dental",
    effectiveStart: "2026-09",
    effectiveEnd: null,
    status: "active" as const,
    entries: [{ recipientType: "team", personName: null, teamName: "Cal Choice Team", compensationBps: 10000 }],
  },
  {
    id: 2,
    groupId: 11,
    groupName: "CJ Torres Construction",
    lineOfBusinessId: 2,
    lineOfBusinessName: "MEDHMO",
    effectiveStart: "2026-09",
    effectiveEnd: null,
    status: "active" as const,
    entries: [{ recipientType: "person", personName: "Maurilio", teamName: null, compensationBps: 10000 }],
  },
  {
    id: 3,
    groupId: 11,
    groupName: "CJ Torres Construction",
    lineOfBusinessId: 3,
    lineOfBusinessName: "MED",
    effectiveStart: "2026-09",
    effectiveEnd: null,
    status: "active" as const,
    entries: [{ recipientType: "person", personName: "Maurilio", teamName: null, compensationBps: 10000 }],
  },
  {
    id: 4,
    groupId: 10,
    groupName: "Fresno Heating and Cooling",
    lineOfBusinessId: 1,
    lineOfBusinessName: "Dental",
    effectiveStart: "2025-01",
    effectiveEnd: "2026-08",
    status: "inactive" as const,
    entries: [{ recipientType: "agency", personName: "Agency", teamName: null, compensationBps: 10000 }],
  },
];

describe("group-first compensation home", () => {
  it("summarizes groups instead of listing every allocation on the home page", () => {
    const groups = compensationGroupSummaries(allocations, [
      { id: 10, name: "Fresno Heating and Cooling" },
      { id: 11, name: "CJ Torres Construction" },
    ]);
    expect(groups.map((group) => [group.groupName, group.activeAllocationCount])).toEqual([
      ["CJ Torres Construction", 2],
      ["Fresno Heating and Cooling", 1],
    ]);
    expect(groupActiveCountLabel(2)).toBe("2 active LOB allocations");
    expect(filterCompensationGroups(groups, "fresno")).toHaveLength(1);
  });

  it("keeps current allocations and history on the selected group only", () => {
    expect(currentAllocationsForGroup(allocations, 10)).toHaveLength(1);
    expect(historicalAllocationsForGroup(allocations, 10)).toHaveLength(1);
    expect(missingLinesForGroup(
      10,
      [{ groupId: 10, lineOfBusinessId: 1 }, { groupId: 10, lineOfBusinessId: 8 }],
      [{ id: 1, name: "Dental" }, { id: 8, name: "Life" }],
      allocations,
    ).map((line) => line.name)).toEqual(["Life"]);
  });
});
