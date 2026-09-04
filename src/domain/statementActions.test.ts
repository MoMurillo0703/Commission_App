import { describe, expect, it } from "vitest";
import {
  acceptedStatementFiles,
  pdfNeedsLayoutConfirmation,
  STATEMENT_INTAKE_FORMATS,
  STATEMENT_INTAKE_LEAD,
  statementListActions,
} from "./statementActions";

function file(name: string) {
  return new File(["x"], name, { type: "application/octet-stream" });
}

describe("statement list actions and intake files", () => {
  it("uses format-neutral intake copy and accepts multiple supported files", () => {
    expect(STATEMENT_INTAKE_LEAD).toMatch(/commission statement/i);
    expect(STATEMENT_INTAKE_LEAD).not.toMatch(/Excel Statement/i);
    expect(STATEMENT_INTAKE_FORMATS).toMatch(/Excel/);
    expect(STATEMENT_INTAKE_FORMATS).toMatch(/CSV/);
    expect(STATEMENT_INTAKE_FORMATS).toMatch(/readable PDF/);
    expect(STATEMENT_INTAKE_FORMATS).toMatch(/Scanned|image-only/i);
    const accepted = acceptedStatementFiles([
      file("book.csv"),
      file("book.xlsx"),
      file("scan.pdf"),
      file("notes.txt"),
      file("image.png"),
    ]);
    expect(accepted.map((item) => item.name)).toEqual(["book.csv", "book.xlsx", "scan.pdf"]);
  });

  it("exposes Delete on unposted statements and blocks hard delete after posting", () => {
    const unposted = statementListActions({ status: "ready_to_map", sourceType: "csv", postedRowCount: 0, rowCount: 4, storedPath: "statements/1-a.csv" });
    expect(unposted.showDelete).toBe(true);
    expect(unposted.reviewLabel).not.toBe("Inspect");
    const posted = statementListActions({ status: "posted", sourceType: "csv", postedRowCount: 2, rowCount: 2, storedPath: "statements/2-a.csv" });
    expect(posted.showDelete).toBe(false);
    expect(posted.deleteBlockedReason).toMatch(/audit trail/);
  });

  it("exposes Review Statement for needs_layout and leftover extracted needs_profile rows", () => {
    const layout = statementListActions({
      status: "needs_layout",
      sourceType: "pdf",
      postedRowCount: 0,
      rowCount: 0,
      extractionPath: "statements/3-extraction.json",
      storedPath: "statements/3-file.pdf",
      preview: { sheets: [], pdf: { classification: "needs_layout" } },
    });
    expect(layout.reviewLabel).toBe("Help the app read this statement");
    expect(layout.canOpenReview).toBe(true);
    expect(layout.showDelete).toBe(true);
    expect(pdfNeedsLayoutConfirmation({
      status: "needs_layout",
      sourceType: "pdf",
      preview: { sheets: [] },
    })).toBe(true);

    const leftover = statementListActions({
      status: "needs_profile",
      sourceType: "pdf",
      postedRowCount: 0,
      rowCount: 0,
      extractionPath: "statements/4-extraction.json",
      preview: { sheets: [], pdf: { classification: "readable" } },
    });
    expect(leftover.reviewLabel).toBe("Help the app read this statement");
    expect(leftover.canOpenReview).toBe(true);
    expect(pdfNeedsLayoutConfirmation({
      status: "needs_profile",
      sourceType: "pdf",
      extractionPath: "statements/4-extraction.json",
      preview: { sheets: [], pdf: { classification: "readable" } },
    })).toBe(true);
  });

  it("keeps scanned PDFs on the unsupported path without Review Statement", () => {
    const scanned = statementListActions({
      status: "unreadable",
      sourceType: "pdf",
      postedRowCount: 0,
      rowCount: 0,
      preview: { sheets: [], pdf: { classification: "unreadable" } },
    });
    expect(scanned.reviewLabel).toBe("View original");
    expect(scanned.canOpenReview).toBe(false);
    expect(pdfNeedsLayoutConfirmation({
      status: "unreadable",
      sourceType: "pdf",
      preview: { sheets: [], pdf: { classification: "unreadable" } },
    })).toBe(false);
  });
});
