import { describe, expect, it } from "vitest";
import {
  buildCompensationDirectoryRows,
  directoryBulkSelectionControl,
  directoryOwnerCoverageWarning,
  emptyCompensationDirectoryFilters,
  filterCompensationDirectory,
  selectAllDirectoryKeys,
} from "./compensationDirectory";

const owner = { personKind: "agent" as const, personId: 2 };
const lines = [
  { id: 1, name: "Group Medical" },
  { id: 2, name: "MED" },
  { id: 12, name: "Group Dental" },
];

describe("compensation directory", () => {
  it("projects durable Group + canonical LOB targets and Select All uses the full filtered set", () => {
    const rows = buildCompensationDirectoryRows({
      asOfMonth: "2026-08",
      owner,
      lines,
      personName: () => "John",
      sources: [
        {
          groupId: 1,
          groupName: "Alpha",
          groupNumber: "A1",
          primaryAgentId: 1,
          primaryAgentName: "John",
          accountManagerId: 3,
          accountManagerName: "Laura",
          carrierIds: [8],
          carrierNames: ["CaliforniaChoice"],
          lineOfBusinessId: 1,
          lineOfBusinessName: "Group Medical",
          allocations: [],
        },
        {
          groupId: 1,
          groupName: "Alpha",
          groupNumber: "A1",
          primaryAgentId: 1,
          primaryAgentName: "John",
          accountManagerId: 3,
          accountManagerName: "Laura",
          carrierIds: [8],
          carrierNames: ["CaliforniaChoice"],
          lineOfBusinessId: 2,
          lineOfBusinessName: "MED",
          allocations: [],
        },
        {
          groupId: 2,
          groupName: "Beta",
          groupNumber: "B2",
          primaryAgentId: 9,
          primaryAgentName: "Other",
          accountManagerId: 4,
          accountManagerName: "Nancy",
          carrierIds: [9],
          carrierNames: ["ChoiceBuilder"],
          lineOfBusinessId: 12,
          lineOfBusinessName: "Group Dental",
          allocations: [{
            id: 40,
            status: "active",
            effectiveStart: "2026-08",
            effectiveEnd: null,
            entries: [{ recipientType: "agency", compensationBps: 10000 }],
          }],
        },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.compensationLabel).toBe("Mo 100% — Default");
    expect(rows[0]?.recipientKeys).toEqual(["agent:2"]);
    const filtered = filterCompensationDirectory(rows, {
      ...emptyCompensationDirectoryFilters("2026-08"),
      carrierId: 8,
      lineOfBusinessId: 2,
      primaryAgentId: 1,
    }, lines);
    expect(filtered).toHaveLength(1);
    expect(selectAllDirectoryKeys(filtered)).toEqual([filtered[0]!.key]);
    expect(selectAllDirectoryKeys(filtered)[0]).toBe("1:medical");
  });

  it("marks conflicting canonical collapse as Review Required", () => {
    const rows = buildCompensationDirectoryRows({
      asOfMonth: "2026-08",
      owner,
      lines,
      personName: () => "John",
      sources: [
        {
          groupId: 1,
          groupName: "Alpha",
          groupNumber: null,
          primaryAgentId: null,
          primaryAgentName: null,
          accountManagerId: null,
          accountManagerName: null,
          carrierIds: [1],
          carrierNames: ["Anthem"],
          lineOfBusinessId: 1,
          lineOfBusinessName: "Group Medical",
          allocations: [{
            id: 1,
            status: "active",
            effectiveStart: "2026-08",
            effectiveEnd: null,
            entries: [{ recipientType: "person", personKind: "agent", personId: 1, compensationBps: 10000 }],
          }],
        },
        {
          groupId: 1,
          groupName: "Alpha",
          groupNumber: null,
          primaryAgentId: null,
          primaryAgentName: null,
          accountManagerId: null,
          accountManagerName: null,
          carrierIds: [1],
          carrierNames: ["Anthem"],
          lineOfBusinessId: 2,
          lineOfBusinessName: "MED",
          allocations: [{
            id: 2,
            status: "active",
            effectiveStart: "2026-08",
            effectiveEnd: null,
            entries: [{ recipientType: "agency", compensationBps: 10000 }],
          }],
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.compensationKind).toBe("review_required");
  });

  it("includes a person who participates through a legacy Team-backed allocation", () => {
    const rows = buildCompensationDirectoryRows({
      asOfMonth: "2026-08",
      owner,
      lines,
      personName: (kind, id) => kind === "agent" && id === 1 ? "John" : "Person",
      teams: [{
        id: 10,
        members: [
          { personKind: "agent", personId: 1, name: "John", shareBps: 7000, status: "active", effectiveStart: "2026-08", effectiveEnd: null },
          { personKind: "agent", personId: 2, name: "Mo", shareBps: 3000, status: "active", effectiveStart: "2026-08", effectiveEnd: null },
        ],
      }],
      sources: [{
        groupId: 1,
        groupName: "Alpha",
        groupNumber: null,
        primaryAgentId: null,
        primaryAgentName: null,
        accountManagerId: null,
        accountManagerName: null,
        carrierIds: [1],
        carrierNames: ["CaliforniaChoice"],
        lineOfBusinessId: 1,
        lineOfBusinessName: "Group Medical",
        allocations: [{
          id: 9,
          status: "active",
          effectiveStart: "2026-08",
          effectiveEnd: null,
          entries: [{ recipientType: "team", teamId: 10, compensationBps: 10000 }],
        }],
      }],
    });
    expect(rows[0]?.recipientKeys).toEqual(expect.arrayContaining(["agent:1", "agent:2"]));
    expect(rows[0]?.recipientKeys).not.toContain("team:10");
    const filtered = filterCompensationDirectory(rows, {
      ...emptyCompensationDirectoryFilters("2026-08"),
      recipientKey: "agent:1",
    }, lines);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.key).toBe("1:medical");
  });

  it("toggles Select all matching to Deselect all once every matching target is selected", () => {
    expect(directoryBulkSelectionControl(0, 65)).toEqual({
      action: "select_all",
      label: "Select all matching (65)",
      disabled: false,
    });
    expect(directoryBulkSelectionControl(12, 65).action).toBe("select_all");
    expect(directoryBulkSelectionControl(65, 65)).toEqual({
      action: "clear",
      label: "Deselect all (65)",
      disabled: false,
    });
  });

  it("does not warn when owner coverage exists and marks missing-owner defaults as Review Required", () => {
    expect(directoryOwnerCoverageWarning(owner, "2026-09")).toBeNull();
    expect(directoryOwnerCoverageWarning(null, "2026-08")).toBe("Agency owner is not configured for August 2026.");
    const missingOwner = buildCompensationDirectoryRows({
      asOfMonth: "2026-08",
      owner: null,
      lines,
      personName: () => "John",
      sources: [{
        groupId: 1,
        groupName: "Alpha",
        groupNumber: null,
        primaryAgentId: null,
        primaryAgentName: null,
        accountManagerId: null,
        accountManagerName: null,
        carrierIds: [1],
        carrierNames: ["CaliforniaChoice"],
        lineOfBusinessId: 1,
        lineOfBusinessName: "Group Medical",
        allocations: [],
      }],
    });
    expect(missingOwner[0]?.compensationKind).toBe("review_required");
    const withOwner = buildCompensationDirectoryRows({
      asOfMonth: "2026-09",
      owner,
      lines,
      personName: () => "John",
      sources: [{
        groupId: 1,
        groupName: "Alpha",
        groupNumber: null,
        primaryAgentId: null,
        primaryAgentName: null,
        accountManagerId: null,
        accountManagerName: null,
        carrierIds: [1],
        carrierNames: ["CaliforniaChoice"],
        lineOfBusinessId: 1,
        lineOfBusinessName: "Group Medical",
        allocations: [{
          id: 8,
          status: "active",
          effectiveStart: "2026-09",
          effectiveEnd: null,
          entries: [{ recipientType: "agency", compensationBps: 10000 }],
        }],
      }],
    });
    expect(withOwner[0]?.compensationKind).toBe("explicit_agency");
    expect(withOwner[0]?.compensationLabel).toBe("Mo 100%");
  });
});
