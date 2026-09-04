import { describe, expect, it } from "vitest";
import {
  pdfIntakeSurface,
  pdfShouldUseExtractedConfirmation,
  statementIntakeHidesCompensationFields,
  statementIntakeMappingLabels,
} from "./pdfIntakeSurface";
import { suggestColumnMapping } from "./columnMapping";

describe("PDF intake surface", () => {
  it("shows extracted-record confirmation for a readable PDF with rows and hides mapping/agent/split", () => {
    const surface = pdfIntakeSurface({
      status: "ready_to_map",
      sourceType: "pdf",
      hasReadableRows: true,
      readyCount: 18,
      blockedCount: 0,
      statementCarrierName: "Choice Builder",
    });
    expect(surface.kind).toBe("extracted_confirmation");
    expect(surface.showMapping).toBe(false);
    expect(surface.showAgent).toBe(false);
    expect(surface.showAgentSplit).toBe(false);
    expect(surface.showCarrierMapping).toBe(false);
    expect(surface.confirmationTitle).toMatch(/extracted commission records/i);
    expect(pdfShouldUseExtractedConfirmation({
      sourceType: "pdf",
      status: "ready_to_map",
      preview: { sheets: [{ rows: [{}] }] },
    })).toBe(true);
  });

  it("keeps extracted rows visible when only some need review", () => {
    const surface = pdfIntakeSurface({
      status: "mapped",
      sourceType: "pdf",
      hasReadableRows: true,
      readyCount: 17,
      blockedCount: 1,
      statementCarrierName: "Choice Builder",
    });
    expect(surface.kind).toBe("partial_confirmation");
    expect(surface.showMapping).toBe(false);
  });

  it("offers advanced help instead of mapping when automatic structure fails", () => {
    const surface = pdfIntakeSurface({
      status: "needs_layout",
      sourceType: "pdf",
      hasReadableRows: false,
      pdfClassification: "needs_layout",
    });
    expect(surface.kind).toBe("structure_fallback");
    expect(surface.showMapping).toBe(false);
    expect(surface.showHelpAction).toBe(true);
  });

  it("states scanned PDFs are unsupported and does not treat them as mapping", () => {
    const surface = pdfIntakeSurface({
      status: "unreadable",
      sourceType: "pdf",
      hasReadableRows: false,
      pdfClassification: "unreadable",
    });
    expect(surface.kind).toBe("scanned_unsupported");
    expect(surface.showMapping).toBe(false);
    expect(surface.showHelpAction).toBe(false);
  });

  it("keeps Agent and Agent split % out of statement intake mapping labels", () => {
    expect(statementIntakeMappingLabels()).not.toContain("Agent");
    expect(statementIntakeMappingLabels()).not.toContain("Agent split %");
    expect(statementIntakeHidesCompensationFields(suggestColumnMapping(["Group Name", "Commission"]))).toBe(true);
  });
});
