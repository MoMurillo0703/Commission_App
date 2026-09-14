import { describe, expect, it } from "vitest";
import { canonicalLineIdsMatching, canonicalLineKey, canonicalizeCompensationTargets, canonicalLockPairs, coveringAllocationsForCanonicalPair, siblingLineIdsFor } from "./canonicalLob";
import { paidMonthInRange } from "./dates";

const lines = [
  { id: 1, name: "Group Medical" },
  { id: 2, name: "MED" },
  { id: 3, name: "MEDHMO" },
  { id: 4, name: "Group Dental" },
  { id: 5, name: "DENPPO" },
  { id: 6, name: "Group Vision" },
  { id: 7, name: "VIS" },
];

describe("canonical LOB projection", () => {
  it("collapses Anthem MED/MEDHMO and dental/vision codes to one family", () => {
    expect(canonicalLineKey(10, { id: 2, name: "MED" })).toBe("10:medical");
    expect(canonicalLineKey(10, { id: 3, name: "MEDHMO" })).toBe("10:medical");
    expect(canonicalLineKey(10, { id: 1, name: "Group Medical" })).toBe("10:medical");
    expect(canonicalLineIdsMatching(1, lines)).toEqual([1, 2, 3]);
    expect(canonicalLineIdsMatching(5, lines)).toEqual([4, 5]);
    expect(canonicalLineIdsMatching(7, lines)).toEqual([6, 7]);
  });

  it("returns every covering raw allocation when a canonical pair collapses", () => {
    const covering = coveringAllocationsForCanonicalPair([
      { id: 21, groupId: 10, lineOfBusinessId: 2, status: "active", effectiveStart: "2026-08", effectiveEnd: null },
      { id: 22, groupId: 10, lineOfBusinessId: 3, status: "active", effectiveStart: "2026-08", effectiveEnd: null },
    ], { groupId: 10, lineOfBusinessId: 1, paidMonth: "2026-08" }, lines, paidMonthInRange);
    expect(covering.map((row) => row.id)).toEqual([21, 22]);
  });

  it("dedupes raw MED and MEDHMO targets to one canonical lock namespace", () => {
    const canonical = canonicalizeCompensationTargets([
      { groupId: 10, lineOfBusinessId: 2 },
      { groupId: 10, lineOfBusinessId: 3 },
      { groupId: 10, lineOfBusinessId: 1 },
    ], lines);
    expect(canonical).toEqual([expect.objectContaining({
      groupId: 10,
      canonicalLineId: 1,
      siblingLineIds: [1, 2, 3],
    })]);
    expect(canonicalLockPairs(canonical)).toEqual([
      { groupId: 10, lineOfBusinessId: 1 },
      { groupId: 10, lineOfBusinessId: 2 },
      { groupId: 10, lineOfBusinessId: 3 },
    ]);
    expect(siblingLineIdsFor({ id: 2, name: "MED" }, lines)).toEqual([1, 2, 3]);
  });
});
