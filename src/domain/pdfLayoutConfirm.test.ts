import { describe, expect, it } from "vitest";
import { candidateRowsFromPdfPages, splitPdfLines } from "./pdfExtraction";
import { previewFromConfirmedPdfLayout, validatePdfLayoutSelection } from "./pdfLayoutConfirm";

const hiddenHeader = "Member    Plan    Paid    Fee";
const hiddenRow = "Acme Benefits    Dental    1000.00    80.00";
const repeatedHeader = hiddenHeader;
const secondRow = "Gamma Group    Dental    250.00    20.00";
const title = "Choice Builder commission statement for the paid month";

function page(pageNumber: number, lines: string[]) {
  return {
    pageNumber,
    text: lines.join("\n"),
    lines: splitPdfLines(lines.join("\n")),
  };
}

describe("confirmed PDF layout candidate rows", () => {
  it("auto-detects Choice Builder Member/Plan/Paid/Fee tables", () => {
    const pages = [page(1, [title, hiddenHeader, hiddenRow, "Total    80.00"])];
    expect(candidateRowsFromPdfPages(pages, []).rowCount).toBeGreaterThan(0);
  });

  it("builds deterministic candidate rows from a confirmed header and data range", () => {
    const pages = [page(1, [title, hiddenHeader, hiddenRow, secondRow, "Total    80.00"])];
    const first = previewFromConfirmedPdfLayout(pages, {
      headerPageNumber: 1,
      headerLineNumber: 2,
      dataStartPageNumber: 1,
      dataStartLineNumber: 3,
      dataEndPageNumber: 1,
      dataEndLineNumber: 4,
    }, []);
    const again = previewFromConfirmedPdfLayout(pages, {
      headerPageNumber: 1,
      headerLineNumber: 2,
      dataStartPageNumber: 1,
      dataStartLineNumber: 3,
      dataEndPageNumber: 1,
      dataEndLineNumber: 4,
    }, []);

    expect(first.preview.rowCount).toBe(2);
    expect(first.preview.sheets[0]?.headers).toEqual(["Member", "Plan", "Paid", "Fee"]);
    expect(first.preview.sheets[0]?.rows.map((row) => row.values.Member)).toEqual(["Acme Benefits", "Gamma Group"]);
    expect(first.preview.sheets[0]?.rows.map((row) => row.sourceIdentity)).toEqual([
      "pdf:page:1:row:3",
      "pdf:page:1:row:4",
    ]);
    expect(again.preview.sheets[0]?.rows.map((row) => row.sourceIdentity)).toEqual(
      first.preview.sheets[0]?.rows.map((row) => row.sourceIdentity),
    );
  });

  it("excludes repeated headers and treats totals conservatively", () => {
    const pages = [page(1, [
      title,
      hiddenHeader,
      hiddenRow,
      repeatedHeader,
      secondRow,
      "Subtotal    100.00",
      "Total    100.00",
      "Page 1 of 1",
    ])];
    const result = previewFromConfirmedPdfLayout(pages, {
      headerPageNumber: 1,
      headerLineNumber: 2,
      dataStartPageNumber: 1,
      dataStartLineNumber: 3,
      dataEndPageNumber: 1,
      dataEndLineNumber: 8,
    }, []);

    expect(result.preview.rowCount).toBe(2);
    expect(result.preview.sheets[0]?.rows.map((row) => row.values.Member)).toEqual(["Acme Benefits", "Gamma Group"]);
    expect(result.preview.sheets.flatMap((sheet) => sheet.rows.map((row) => row.values.Member))).not.toContain("Total");
    expect(result.preview.sheets.flatMap((sheet) => sheet.rows.map((row) => row.values.Member))).not.toContain("Member");
  });

  it("leaves unrecognized groups unresolved instead of fabricating matches", () => {
    const pages = [page(1, [title, hiddenHeader, hiddenRow])];
    const result = previewFromConfirmedPdfLayout(pages, {
      headerPageNumber: 1,
      headerLineNumber: 2,
      dataStartPageNumber: 1,
      dataStartLineNumber: 3,
      dataEndPageNumber: 1,
      dataEndLineNumber: 3,
    }, [{ id: 1, name: "Other Group", groupNumber: "Z9" }]);

    expect(result.preview.sheets[0]?.rows[0]?.group.status).toBe("new_group");
    expect(result.preview.sheets[0]?.rows[0]?.values.Fee).toBe("80.00");
  });

  it("rejects an incomplete or reversed selection", () => {
    const pages = [page(1, [title, hiddenHeader, hiddenRow])];
    expect(validatePdfLayoutSelection(pages, {
      headerPageNumber: 1,
      headerLineNumber: 2,
      dataStartPageNumber: 1,
      dataStartLineNumber: 3,
      dataEndPageNumber: 1,
      dataEndLineNumber: 1,
    })).toMatch(/last commission row/i);
    expect(validatePdfLayoutSelection(pages, {
      headerPageNumber: 1,
      headerLineNumber: 99,
      dataStartPageNumber: 1,
      dataStartLineNumber: 3,
      dataEndPageNumber: 1,
      dataEndLineNumber: 3,
    })).toMatch(/header row/i);
  });
});
