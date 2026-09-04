import { describe, expect, it } from "vitest";
import { activeLineIdsForGroup, linesForGroupSelection } from "./activeGroupLines";

const lines = [
  { id: 1, name: "Dental" },
  { id: 2, name: "Group Vision" },
  { id: 3, name: "Medical" },
];

describe("active group lines of business", () => {
  it("returns only evidenced lines for the selected group", () => {
    const evidence = [
      { groupId: 10, lineOfBusinessId: 1 },
      { groupId: 10, lineOfBusinessId: 2 },
      { groupId: 10, lineOfBusinessId: 1 },
      { groupId: 11, lineOfBusinessId: 3 },
    ];
    expect(activeLineIdsForGroup(10, evidence)).toEqual([1, 2]);
    expect(linesForGroupSelection(10, lines, evidence).map((line) => line.name)).toEqual([
      "Dental",
      "Group Vision",
    ]);
    expect(linesForGroupSelection(11, lines, evidence).map((line) => line.name)).toEqual(["Medical"]);
  });

  it("does not list every system LOB when a group has no evidence", () => {
    expect(linesForGroupSelection(10, lines, [])).toEqual([]);
    expect(linesForGroupSelection(null, lines, [{ groupId: 10, lineOfBusinessId: 1 }])).toEqual([]);
  });

  it("keeps a queue or in-progress line visible without adding unrelated LOBs", () => {
    const visible = linesForGroupSelection(10, lines, [{ groupId: 10, lineOfBusinessId: 1 }], [2]);
    expect(visible.map((line) => line.id)).toEqual([1, 2]);
  });
});
