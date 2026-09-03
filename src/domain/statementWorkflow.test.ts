import { describe, expect, it } from "vitest";
import {
  canReviewRows,
  isUnparsedStatement,
  statementGuidance,
  statementHasReadableRows,
  statementNextAction,
  statementStatusLabel,
} from "./statementWorkflow";

describe("statement workflow language", () => {
  it("uses plain-language labels instead of technical statuses", () => {
    expect(statementStatusLabel("ready_to_map")).toBe("Needs review");
    expect(statementStatusLabel("mapped")).toBe("Ready to continue");
    expect(statementStatusLabel("needs_profile")).toBe("PDF reading not supported yet");
    expect(statementStatusLabel("needs_conversion")).toBe("XLS reading not supported yet");
    expect(statementStatusLabel("ready_to_map", "pdf")).toBe("PDF reading not supported yet");
    expect(statementNextAction("needs_profile", false, "pdf")).toBe("View original");
    expect(statementNextAction("ready_to_map", false, "pdf")).toBe("View original");
    expect(statementNextAction("ready_to_map", true)).toBe("Review Statement");
    expect(statementNextAction("mapped", true)).toBe("Continue Import");
  });

  it("marks stored PDFs as unparsed so they cannot enter mapping", () => {
    expect(isUnparsedStatement({ status: "needs_profile", sourceType: "pdf" })).toBe(true);
    expect(isUnparsedStatement({ status: "ready_to_map", sourceType: "pdf" })).toBe(true);
    expect(canReviewRows({ sheets: [] })).toBe(false);
    expect(statementHasReadableRows({ preview: { sheets: [] }, rowCount: 0, sourceType: "pdf" })).toBe(false);
  });

  it("explains PDF and XLS limitations without extraction-profile language", () => {
    const pdf = statementGuidance({ status: "needs_profile", sourceType: "pdf" });
    expect(pdf.title).toMatch(/could not read/i);
    expect(pdf.why).toMatch(/not extracted|original file is kept/i);
    expect(pdf.title + pdf.why + pdf.next).not.toMatch(/profile/i);
    expect(`${pdf.title} ${pdf.why} ${pdf.next}`).not.toMatch(/0 rows ready to map/i);
    const xls = statementGuidance({ status: "needs_conversion", sourceType: "xls" });
    expect(xls.next).toMatch(/xlsx|csv/i);
  });

  it("treats saved CSV/XLSX row counts as resumable even when preview is omitted from the list", () => {
    expect(canReviewRows(null)).toBe(false);
    expect(statementHasReadableRows({ preview: null, rowCount: 12, sourceType: "csv" })).toBe(true);
    expect(statementHasReadableRows({ preview: null, rowCount: 0, sourceType: "pdf" })).toBe(false);
  });
});
