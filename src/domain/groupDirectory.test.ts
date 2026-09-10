import { describe, expect, it } from "vitest";
import {
  emptyGroupDirectoryFilters,
  filterGroupDirectory,
  groupAlphabetKey,
  groupDirectoryCountLabel,
  groupMatchesSearch,
  type GroupDirectoryRow,
} from "./groupDirectory";

function row(patch: Partial<GroupDirectoryRow> & Pick<GroupDirectoryRow, "id" | "name">): GroupDirectoryRow {
  return {
    groupNumber: null,
    externalGroupNumbers: [],
    primaryAgentId: null,
    primaryAgentName: null,
    accountManagerId: null,
    accountManagerName: null,
    carrierIds: [],
    carrierNames: [],
    lineOfBusinessIds: [],
    lineOfBusinessNames: [],
    compensationKind: "default_unconfigured",
    compensationLabel: "Default",
    ...patch,
  };
}

describe("group directory filters", () => {
  const rows = [
    row({
      id: 1,
      name: "Acme Benefits",
      groupNumber: "A1",
      externalGroupNumbers: ["CA02483"],
      primaryAgentId: 2,
      primaryAgentName: "John",
      accountManagerId: 9,
      accountManagerName: "Laura",
      carrierIds: [4],
      carrierNames: ["Beam"],
      lineOfBusinessIds: [8],
      lineOfBusinessNames: ["Life"],
      compensationKind: "explicit_configured",
      compensationLabel: "Configured",
    }),
    row({
      id: 2,
      name: "9th Street Dental",
      groupNumber: "D9",
    }),
  ];

  it("searches name, legacy group number, and carrier-scoped number", () => {
    expect(groupMatchesSearch(rows[0]!, "acme")).toBe(true);
    expect(groupMatchesSearch(rows[0]!, "A1")).toBe(true);
    expect(groupMatchesSearch(rows[0]!, "ca02483")).toBe(true);
    expect(groupMatchesSearch(rows[0]!, "missing")).toBe(false);
  });

  it("combines filters with AND semantics and alphabet keys", () => {
    expect(groupAlphabetKey("Acme")).toBe("A");
    expect(groupAlphabetKey("9th Street")).toBe("#");
    const filtered = filterGroupDirectory(rows, {
      ...emptyGroupDirectoryFilters(),
      query: "acme",
      carrierId: 4,
      lineOfBusinessId: 8,
      primaryAgentId: 2,
      accountManagerId: 9,
      compensationStatus: "configured",
    });
    expect(filtered.map((item) => item.id)).toEqual([1]);
    expect(filterGroupDirectory(rows, { ...emptyGroupDirectoryFilters(), letter: "#" }).map((item) => item.id)).toEqual([2]);
    expect(filterGroupDirectory(rows, { ...emptyGroupDirectoryFilters(), unassignedPrimaryAgent: true }).map((item) => item.id)).toEqual([2]);
    expect(groupDirectoryCountLabel(1, 2)).toBe("1 of 2 groups");
  });
});
