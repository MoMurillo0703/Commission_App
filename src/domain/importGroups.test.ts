import { describe, expect, it } from "vitest";
import { collectUnmatchedImportGroups, groupNumberConflict, proposedGroupName } from "./importGroups";

function row(name: string, number: string | null, extra = false) {
  return {
    importedGroupName: name,
    importedGroupNumber: number,
    exceptions: extra ? ["Unmatched group: " + name, "Unmatched carrier: X"] : [`Unmatched group: ${name}`],
  };
}

describe("import group review", () => {
  it("collapses many rows for one new group into a single review item", () => {
    const unmatched = collectUnmatchedImportGroups([
      row("Empower Speech", "ES-9"),
      row("empower  speech", "ES-9"),
      row("Beta Co", "B2"),
    ]);
    expect(unmatched).toHaveLength(2);
    expect(unmatched.find((group) => group.sourceName === "Empower Speech")?.rowCount).toBe(2);
    expect(proposedGroupName({ sourceName: "Empower Speech", sourceNumber: "ES-9" })).toBe("Empower Speech");
  });

  it("keeps the same normalized name with different group numbers separate", () => {
    const unmatched = collectUnmatchedImportGroups([
      row("Acme", "A1"),
      row(" acme ", "A2"),
    ]);
    expect(unmatched).toHaveLength(2);
    expect(unmatched.map((group) => group.key).sort()).toEqual([
      "name:acme|number:a1",
      "name:acme|number:a2",
    ]);
  });

  it("ignores rows that are blocked for other reasons only when they are not unmatched groups", () => {
    expect(collectUnmatchedImportGroups([
      { importedGroupName: "Acme", importedGroupNumber: "A1", exceptions: ["Unmatched carrier: X"] },
    ])).toHaveLength(0);
  });

  it("flags a group-number conflict without treating it as a merge", () => {
    expect(groupNumberConflict({ id: 1, name: "Acme Benefits", groupNumber: "A1" }, "ES-9")).toBe(true);
    expect(groupNumberConflict({ id: 1, name: "Acme Benefits", groupNumber: "a1" }, "A1")).toBe(false);
    expect(groupNumberConflict({ id: 1, name: "Acme Benefits", groupNumber: null }, "ES-9")).toBe(false);
  });
});
