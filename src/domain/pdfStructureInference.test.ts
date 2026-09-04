import { describe, expect, it } from "vitest";
import { inferPdfStatementStructure, interpretExtractedPdfPages } from "./pdfStructureInference";
import { candidateRowsFromPdfPages } from "./pdfExtraction";
import { choiceBuilderStatementLines } from "../../tests/helpers/pdfFixtures";

const choiceBuilderLines = [
  "Choice Builder commission statement for the paid month with readable embedded text.",
  "Member    Plan    Paid    Fee",
  "Acme Benefits    Dental    1000.00    80.00",
  "Member    Plan    Paid    Fee",
  "Gamma Group    Dental    250.00    20.00",
  "Subtotal    100.00",
  "Total    100.00",
  "Page 1 of 1",
];

describe("automatic PDF structure inference", () => {
  it("extracts Choice Builder Member/Plan/Paid/Fee rows without manual layout", () => {
    const pages = [{ pageNumber: 1, text: choiceBuilderLines.join("\n"), lines: choiceBuilderLines }];
    const inferred = inferPdfStatementStructure(pages, []);
    expect(inferred?.preview.rowCount).toBe(2);
    expect(inferred?.mapping).toMatchObject({
      groupName: "Member",
      lineOfBusiness: "Plan",
      premium: "Paid",
      grossCommission: "Fee",
    });
    expect(inferred?.preview.sheets[0]?.rows.map((row) => row.values.Member)).toEqual([
      "Acme Benefits",
      "Gamma Group",
    ]);
    expect(inferred?.mapping.agent).toBeFalsy();
  });

  it("infers a table when the first-pass header heuristic finds zero rows", () => {
    const lines = [
      "Customer    Offering    CompFee",
      "Acme Benefits    Dental    80.00",
      "Smith Farms    Vision    62.00",
    ];
    const pages = [{ pageNumber: 1, text: lines.join("\n"), lines }];
    expect(candidateRowsFromPdfPages(pages, []).rowCount).toBe(0);
    const inferred = inferPdfStatementStructure(pages, []);
    expect(inferred?.preview.rowCount).toBe(2);
    expect(inferred?.mapping.groupName).toBe("Customer");
    expect(inferred?.mapping.grossCommission).toBe("CompFee");
    expect(inferred?.preview.sheets[0]?.rows[0]?.values.Customer).toBe("Acme Benefits");
  });

  it("does not invent a table from narrative text", () => {
    const lines = [
      "Choice Builder commission statement narrative with enough words and letters to count as readable text without a table of groups premiums or commissions.",
    ];
    expect(inferPdfStatementStructure([{ pageNumber: 1, text: lines.join("\n"), lines }], [])).toBeNull();
    expect(candidateRowsFromPdfPages([{ pageNumber: 1, text: lines.join("\n"), lines }], []).rowCount).toBe(0);
  });

  it("reads a Choice Builder Company Name / Product / Comm Amount statement with continuation rows", () => {
    const pages = [{ pageNumber: 1, text: choiceBuilderStatementLines.join("\n"), lines: choiceBuilderStatementLines }];
    const inferred = inferPdfStatementStructure(pages, []);
    expect(inferred?.preview.rowCount).toBe(6);
    expect(inferred?.mapping).toMatchObject({
      groupName: "Company Name",
      groupNumber: "Policy Number",
      lineOfBusiness: "Product",
      premiumMonth: "Paid Month",
      grossCommission: "Comm Amount",
    });
    const rows = inferred?.preview.sheets[0]?.rows ?? [];
    expect(rows.map((row) => row.values["Company Name"])).toEqual([
      "ACME PET RESORT",
      "ACME PET RESORT",
      "ACME PET RESORT",
      "ACME PET RESORT",
      "SMITH FARMS",
      "SMITH FARMS",
    ]);
    expect(rows.map((row) => row.values["Policy Number"])).toEqual([
      "B05095",
      "B05095",
      "B05095",
      "B05095",
      "B16568",
      "B16568",
    ]);
    expect(rows.map((row) => row.values.Product)).toEqual([
      "Dental",
      "Vision",
      "Dental",
      "Vision",
      "Dental",
      "Vision",
    ]);
    expect(rows.every((row) => row.group.status === "new_group")).toBe(true);
    expect(interpretExtractedPdfPages(pages, [])?.preview.rowCount).toBe(6);
    expect(inferred?.mapping.agent).toBeFalsy();
  });

  it("keeps extracted rows when one coverage value is unknown", () => {
    const lines = [
      "Member    Plan    Paid    Fee",
      "Acme Benefits    Dental    1000.00    80.00",
      "Smith Farms    VIS    620.00    62.00",
    ];
    const inferred = inferPdfStatementStructure([{ pageNumber: 1, text: lines.join("\n"), lines }], [
      { id: 1, name: "Acme Benefits", groupNumber: null },
    ]);
    expect(inferred?.preview.rowCount).toBe(2);
    expect(inferred?.preview.sheets[0]?.rows[1]?.values.Plan).toBe("VIS");
  });
});
