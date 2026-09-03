import { describe, expect, it } from "vitest";
import {
  canReviewRows,
  statementGuidance,
  statementHasReadableRows,
  statementNextAction,
  statementStatusLabel,
} from "./statementWorkflow";

describe("statement workflow language", () => {
  it("uses plain-language labels instead of technical statuses", () => {
    expect(statementStatusLabel("ready_to_map")).toBe("Needs review");
    expect(statementStatusLabel("mapped")).toBe("Ready to continue");
    expect(statementStatusLabel("needs_profile")).toBe("Needs attention");
    expect(statementStatusLabel("needs_conversion")).toBe("Needs attention");
    expect(statementNextAction("ready_to_map", true)).toBe("Review Statement");
    expect(statementNextAction("mapped", true)).toBe("Continue Import");
  });

  it("explains PDF and XLS limitations without extraction-profile language", () => {
    const pdf = statementGuidance({ status: "needs_profile", sourceType: "pdf" });
    expect(pdf.title).toMatch(/could not read/i);
    expect(pdf.title + pdf.why + pdf.next).not.toMatch(/profile/i);
    const xls = statementGuidance({ status: "needs_conversion", sourceType: "xls" });
    expect(xls.next).toMatch(/xlsx|csv/i);
  });

  it("treats saved CSV/XLSX row counts as resumable even when preview is omitted from the list", () => {
    expect(canReviewRows(null)).toBe(false);
    expect(statementHasReadableRows({ preview: null, rowCount: 12, sourceType: "csv" })).toBe(true);
    expect(statementHasReadableRows({ preview: null, rowCount: 0, sourceType: "pdf" })).toBe(false);
  });
});
