import { describe, expect, it } from "vitest";
import { buildLayoutSignature, mappingsEqual, signaturesMatch } from "./pdfLayout";

describe("carrier statement layout signatures", () => {
  it("matches the same header fingerprint and overlapping first-page tokens", () => {
    const first = buildLayoutSignature(
      ["Group Name", "Commission", "Premium"],
      "Sanitized Mutual Commission Statement August 2026",
    );
    const later = buildLayoutSignature(
      ["Group Name", "Premium", "Commission"],
      "Sanitized Mutual Commission Statement September 2026",
    );
    expect(signaturesMatch(first, later)).toBe(true);
    expect(signaturesMatch(first, buildLayoutSignature(["Other"], "Unrelated"))).toBe(false);
  });

  it("treats mapping changes as a new layout version candidate", () => {
    expect(mappingsEqual({ groupName: "Group Name" }, { groupName: "Group Name" })).toBe(true);
    expect(mappingsEqual({ groupName: "Group Name" }, { groupName: "Name" })).toBe(false);
  });
});
