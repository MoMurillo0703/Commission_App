import { describe, expect, it } from "vitest";
import { applyCarrierCoverageAlias, findCarrierCoverageAlias, normalizeCoverageValue } from "./carrierCoverage";

const aliases = [
  { carrierId: 1, sourceValue: "vis", lineOfBusinessId: 20 },
];
const lines = [
  { id: 20, name: "Group Vision" },
  { id: 21, name: "Dental" },
];

describe("carrier coverage aliases", () => {
  it("normalizes source coverage values", () => {
    expect(normalizeCoverageValue(" VIS ")).toBe("vis");
    expect(normalizeCoverageValue("Group   Vision")).toBe("group vision");
    expect(normalizeCoverageValue("")).toBeNull();
  });

  it("resolves a confirmed alias only for that carrier", () => {
    const unmatched = { status: "unmatched" as const, id: null, name: null, source: "VIS" };
    expect(applyCarrierCoverageAlias(unmatched, aliases, 1, "VIS", lines)).toMatchObject({
      status: "matched",
      id: 20,
      name: "Group Vision",
    });
    expect(applyCarrierCoverageAlias(unmatched, aliases, 2, "VIS", lines)).toEqual(unmatched);
    expect(findCarrierCoverageAlias(aliases, 2, "VIS")).toBeNull();
  });

  it("does not override an exact name match or apply a missing line", () => {
    const matched = { status: "matched" as const, id: 21, name: "Dental", source: "Dental" };
    expect(applyCarrierCoverageAlias(matched, aliases, 1, "VIS", lines)).toEqual(matched);
    expect(applyCarrierCoverageAlias(
      { status: "unmatched", id: null, name: null, source: "VIS" },
      aliases,
      1,
      "VIS",
      [],
    )).toMatchObject({ status: "unmatched" });
  });
});
