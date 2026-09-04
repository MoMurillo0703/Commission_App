import { describe, expect, it } from "vitest";
import {
  canReviewRows,
  isUnparsedStatement,
  statementCanBeDeleted,
  statementDeleteBlockedReason,
  statementGuidance,
  statementHasReadableRows,
  statementCanOpenReview,
  statementKeepViewOriginal,
  statementNextAction,
  statementStatusLabel,
} from "./statementWorkflow";

describe("statement workflow language", () => {
  it("uses plain-language labels instead of technical statuses", () => {
    expect(statementStatusLabel("ready_to_map")).toBe("Needs review");
    expect(statementStatusLabel("mapped")).toBe("Ready to continue");
    expect(statementStatusLabel("unreadable")).toBe("Scanned/image PDF cannot yet be read");
    expect(statementStatusLabel("extraction_failed")).toBe("PDF extraction failed — original retained");
    expect(statementStatusLabel("needs_layout")).toBe("Needs help reading");
    expect(statementStatusLabel("needs_conversion")).toBe("XLS reading not supported yet");
    expect(statementStatusLabel("ready_to_map", "pdf", true)).toBe("Text-based PDF successfully read");
    expect(statementNextAction("unreadable", false, "pdf")).toBe("View original");
    expect(statementNextAction("ready_to_map", true, "pdf")).toBe("Confirm extracted data");
    expect(statementNextAction("needs_layout", false, "pdf")).toBe("Help the app read this statement");
    expect(statementNextAction("mapped", true)).toBe("Continue Import");
    expect(statementCanOpenReview("needs_layout", false, "pdf")).toBe(true);
    expect(statementNextAction("needs_profile", false, "pdf", { extractionPath: "statements/1-extraction.json" })).toBe("Help the app read this statement");
    expect(statementNextAction("needs_profile", false, "pdf")).toBe("View original");
    expect(statementNextAction("needs_layout", false, "pdf")).not.toBe("Inspect");
    expect(statementKeepViewOriginal("needs_layout", false, "pdf")).toBe(true);
  });

  it("lets readable PDFs enter review and keeps scanned PDFs unparsed", () => {
    expect(isUnparsedStatement({ status: "unreadable", sourceType: "pdf" })).toBe(true);
    expect(isUnparsedStatement({ status: "extraction_failed", sourceType: "pdf" })).toBe(true);
    expect(isUnparsedStatement({ status: "needs_profile", sourceType: "pdf" })).toBe(true);
    expect(isUnparsedStatement({ status: "needs_profile", sourceType: "pdf", extractionPath: "statements/1-extraction.json" })).toBe(false);
    expect(isUnparsedStatement({ status: "ready_to_map", sourceType: "pdf" }, true)).toBe(false);
    expect(canReviewRows({ sheets: [] })).toBe(false);
    expect(statementHasReadableRows({ preview: { sheets: [] }, rowCount: 0, sourceType: "pdf" })).toBe(false);
    expect(statementHasReadableRows({ preview: null, rowCount: 12, sourceType: "pdf" })).toBe(true);
  });

  it("explains PDF and XLS limitations without extraction-profile language", () => {
    const scanned = statementGuidance({ status: "unreadable", sourceType: "pdf" });
    expect(scanned.why).toMatch(/not supported yet|original file has been saved/i);
    expect(`${scanned.title} ${scanned.why} ${scanned.next}`).not.toMatch(/profile/i);
    const layout = statementGuidance({ status: "needs_layout", sourceType: "pdf", hasReadableRows: true });
    expect(layout.title).toMatch(/extracted commission data/i);
    expect(layout.next).toMatch(/Confirm the extracted/i);
    expect(`${layout.title} ${layout.why} ${layout.next}`).not.toMatch(/profile/i);
    const noTable = statementGuidance({ status: "needs_layout", sourceType: "pdf", hasReadableRows: false });
    expect(noTable.title).toMatch(/could not automatically find the commission table/i);
    expect(noTable.next).toMatch(/Help the app read this statement/i);
    expect(noTable.next).toMatch(/CSV or XLSX/i);
    expect(noTable.next).not.toMatch(/Open the statement to see what still needs attention/i);
    expect(isUnparsedStatement({ status: "needs_layout", sourceType: "pdf" })).toBe(false);
    const xls = statementGuidance({ status: "needs_conversion", sourceType: "xls" });
    expect(xls.next).toMatch(/xlsx|csv/i);
  });

  it("treats saved CSV/XLSX row counts as resumable even when preview is omitted from the list", () => {
    expect(canReviewRows(null)).toBe(false);
    expect(statementHasReadableRows({ preview: null, rowCount: 12, sourceType: "csv" })).toBe(true);
    expect(statementHasReadableRows({ preview: null, rowCount: 0, sourceType: "pdf" })).toBe(false);
  });

  it("blocks deletion only after commissions have been posted", () => {
    expect(statementCanBeDeleted({ status: "ready_to_map", postedRowCount: 0 })).toBe(true);
    expect(statementCanBeDeleted({ status: "mapped", postedRowCount: 0 })).toBe(true);
    expect(statementCanBeDeleted({ status: "needs_profile", postedRowCount: 0 })).toBe(true);
    expect(statementCanBeDeleted({ status: "unreadable", postedRowCount: 0 })).toBe(true);
    expect(statementCanBeDeleted({ status: "posted", postedRowCount: 1 })).toBe(false);
    expect(statementCanBeDeleted({ status: "partially_posted", postedRowCount: 2 })).toBe(false);
    expect(statementCanBeDeleted({ status: "mapped", postedRowCount: 1 })).toBe(false);
    expect(statementDeleteBlockedReason()).toMatch(/audit trail/i);
  });
});
