import { describe, expect, it } from "vitest";
import { candidateRowsFromPdfPages, classifyPdfText, isIgnoredPdfLine, splitPdfLines } from "./pdfExtraction";

const header = "Group Name    Group Number    LOB    Agent    Premium    Commission    Coverage Month";
const data = "Acme Benefits    A1    Dental    Alex Morgan    1000.00    80.00    2026-07";

describe("PDF candidate extraction", () => {
  it("classifies text PDFs as readable and image-like PDFs as unreadable", () => {
    const readable = classifyPdfText([{
      pageNumber: 1,
      text: ["SANITIZED CARRIER COMMISSION STATEMENT", header, data].join("\n"),
      lines: splitPdfLines(["SANITIZED CARRIER COMMISSION STATEMENT", header, data].join("\n")),
    }]);
    expect(readable.classification).toBe("readable");
    const scanned = classifyPdfText([{ pageNumber: 1, text: " ", lines: [] }]);
    expect(scanned.classification).toBe("unreadable");
    expect(scanned.message).toMatch(/scanned or image-based/i);
  });

  it("extracts candidate rows, keeps page identity, and ignores repeated headers and totals", () => {
    const preview = candidateRowsFromPdfPages([
      {
        pageNumber: 1,
        text: ["STATEMENT", header, data, "Subtotal    80.00", "Total    80.00", "Page 1 of 2"].join("\n"),
        lines: splitPdfLines(["STATEMENT", header, data, "Subtotal    80.00", "Total    80.00", "Page 1 of 2"].join("\n")),
      },
      {
        pageNumber: 2,
        text: [header, "Gamma Group    G3    Dental    Alex Morgan    250.00    20.00    2026-08", "Grand Total    100.00"].join("\n"),
        lines: splitPdfLines([header, "Gamma Group    G3    Dental    Alex Morgan    250.00    20.00    2026-08", "Grand Total    100.00"].join("\n")),
      },
    ], []);
    expect(preview.rowCount).toBe(2);
    expect(preview.sheets.map((sheet) => sheet.name)).toEqual(["Page 1", "Page 2"]);
    expect(preview.sheets[0]?.rows[0]?.pageNumber).toBe(1);
    expect(preview.sheets[1]?.rows[0]?.pageNumber).toBe(2);
    expect(preview.sheets[0]?.rows[0]?.sourceIdentity).toBe("pdf:page:1:row:1");
    expect(preview.sheets.flatMap((sheet) => sheet.rows.map((row) => row.values["Group Name"]))).toEqual([
      "Acme Benefits",
      "Gamma Group",
    ]);
    expect(isIgnoredPdfLine("Total    80.00")).toBe(true);
    expect(isIgnoredPdfLine(header, header.split(/\s{2,}/))).toBe(true);
  });

  it("uses the prior page header on continuation pages without fabricating totals, footers, or wrapped text", () => {
    const preview = candidateRowsFromPdfPages([
      {
        pageNumber: 1,
        text: [header, data, "Page 1 of 2"].join("\n"),
        lines: splitPdfLines([header, data, "Page 1 of 2"].join("\n")),
      },
      {
        pageNumber: 2,
        text: [
          "Gamma Group    G3    Dental    Alex Morgan    250.00    20.00    2026-08",
          "continued",
          "wrapped description without financial columns",
          "Commission Total    100.00",
          "Confidential",
          "Page 2 of 2",
        ].join("\n"),
        lines: splitPdfLines([
          "Gamma Group    G3    Dental    Alex Morgan    250.00    20.00    2026-08",
          "continued",
          "wrapped description without financial columns",
          "Commission Total    100.00",
          "Confidential",
          "Page 2 of 2",
        ].join("\n")),
      },
    ], []);

    expect(preview.rowCount).toBe(2);
    expect(preview.sheets[1]?.rows).toHaveLength(1);
    expect(preview.sheets[1]?.rows[0]?.values["Group Name"]).toBe("Gamma Group");
    expect(preview.sheets[1]?.rows[0]?.sourceIdentity).toBe("pdf:page:2:row:1");
  });
});
