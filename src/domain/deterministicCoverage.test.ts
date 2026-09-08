import { describe, expect, it } from "vitest";
import { applyCarrierCoverageAlias } from "./carrierCoverage";
import {
  applyDeterministicCoverageMapping,
  deterministicCoverageFamily,
  isAnthemFamilyCarrier,
} from "./deterministicCoverage";

const lines = [
  { id: 1, name: "MED" },
  { id: 2, name: "Medical" },
  { id: 3, name: "Dental" },
  { id: 4, name: "Vision" },
  { id: 5, name: "DENPPO" },
  { id: 6, name: "Group Medical" },
];

describe("deterministic Anthem coverage mapping", () => {
  it("recognizes Anthem/Elevance carriers only", () => {
    expect(isAnthemFamilyCarrier("Anthem")).toBe(true);
    expect(isAnthemFamilyCarrier("Elevance Health")).toBe(true);
    expect(isAnthemFamilyCarrier("ChoiceBuilder")).toBe(false);
    expect(isAnthemFamilyCarrier("CaliforniaChoice")).toBe(false);
  });

  it("maps only exact known Anthem source codes", () => {
    expect(deterministicCoverageFamily("Anthem", "MED")).toBe("medical");
    expect(deterministicCoverageFamily("Anthem", "MEDHMO")).toBe("medical");
    expect(deterministicCoverageFamily("Anthem", "DENPPO")).toBe("dental");
    expect(deterministicCoverageFamily("Anthem", "VIS")).toBe("vision");
    expect(deterministicCoverageFamily("Anthem", "LIFE")).toBeNull();
    expect(deterministicCoverageFamily("ChoiceBuilder", "MED")).toBeNull();
  });

  it("prefers canonical Group Medical over a raw MED name match", () => {
    const raw = { status: "matched" as const, id: 1, name: "MED", source: "MED" };
    expect(applyDeterministicCoverageMapping(raw, {
      carrierName: "Anthem",
      sourceValue: "MED",
      lines,
    })).toMatchObject({ status: "matched", id: 6, name: "Group Medical", source: "MED" });
  });

  it("does not guess unknown coverage labels", () => {
    const unmatched = { status: "unmatched" as const, id: null, name: null, source: "XYZ" };
    expect(applyDeterministicCoverageMapping(unmatched, {
      carrierName: "Anthem",
      sourceValue: "XYZ",
      lines,
    })).toEqual(unmatched);
  });

  it("leaves stored aliases in place when they already point at the canonical line", () => {
    const unmatched = { status: "unmatched" as const, id: null, name: null, source: "VIS" };
    const aliased = applyCarrierCoverageAlias(
      unmatched,
      [{ carrierId: 9, sourceValue: "vis", lineOfBusinessId: 4 }],
      9,
      "VIS",
      lines,
    );
    expect(applyDeterministicCoverageMapping(aliased, {
      carrierName: "Anthem",
      sourceValue: "VIS",
      lines,
    })).toMatchObject({ status: "matched", id: 4, name: "Vision" });
  });
});
