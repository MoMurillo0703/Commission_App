import { describe, expect, it } from "vitest";
import { interpretExtractedPdfPages } from "./pdfStructureInference";
import { interpretCaliforniaChoiceStatement, parseCaliforniaChoiceLines } from "./californiaChoice";
import { choiceBuilderStatementLines } from "../../tests/helpers/pdfFixtures";

const californiaChoiceLines = [
  "CaliforniaChoice Commission Statement",
  "August 2026",
  "83746",
  "CHIMAY ENTERPRISE LLC",
  "09-26",
  "Medical",
  "$4,776.34",
  "5.0",
  "$238.81",
  "09-26",
  "Chiro",
  "$45.24",
  "6.5",
  "$2.96",
  "09-26",
  "Vision",
  "$61.80",
  "12.0",
  "$7.42",
  "65884",
  "JOSES ORNAMENTAL SUPPLY INC",
  "09-26    Dental    $120.00    5.0    $6.00",
  "09-26    Dental    ($10.00)    5.0    ($0.50)",
  "09-26    Medical    $800.00    5.0    $40.00",
  "09-26    Vision    $50.00    12.0    $6.00",
];

describe("CaliforniaChoice continuation parsing", () => {
  it("carries Group Number and Company Name onto continuation LOB rows", () => {
    const rows = parseCaliforniaChoiceLines(californiaChoiceLines);
    expect(rows.map((row) => [row.groupNumber, row.groupName, row.product, row.commission])).toEqual([
      ["83746", "CHIMAY ENTERPRISE LLC", "Medical", "$238.81"],
      ["83746", "CHIMAY ENTERPRISE LLC", "Chiro", "$2.96"],
      ["83746", "CHIMAY ENTERPRISE LLC", "Vision", "$7.42"],
      ["65884", "JOSES ORNAMENTAL SUPPLY INC", "Dental", "$6.00"],
      ["65884", "JOSES ORNAMENTAL SUPPLY INC", "Dental", "($0.50)"],
      ["65884", "JOSES ORNAMENTAL SUPPLY INC", "Medical", "$40.00"],
      ["65884", "JOSES ORNAMENTAL SUPPLY INC", "Vision", "$6.00"],
    ]);
    expect(rows[0]).toMatchObject({ paidMonth: "2026-09", premium: "$4,776.34", rate: "5.0" });
    expect(rows.some((row) => /medical|dental|vision|chiro/i.test(row.groupName))).toBe(false);
  });

  it("does not create Group candidates from Medical, Dental, Vision, or Chiro", () => {
    const pages = [{ pageNumber: 1, text: californiaChoiceLines.join("\n"), lines: californiaChoiceLines }];
    const inferred = interpretCaliforniaChoiceStatement(pages, []);
    const names = inferred?.preview.sheets.flatMap((sheet) => sheet.rows.map((row) => row.values["Company Name"])) ?? [];
    expect(names.every((name) => name === "CHIMAY ENTERPRISE LLC" || name === "JOSES ORNAMENTAL SUPPLY INC")).toBe(true);
    expect(inferred?.preview.sheets[0]?.rows.map((row) => row.values.Product)).toEqual([
      "Medical", "Chiro", "Vision", "Dental", "Dental", "Medical", "Vision",
    ]);
    const unmatched = inferred?.preview.unmatchedGroups.map((group) => group.sourceName) ?? [];
    expect(unmatched).not.toEqual(expect.arrayContaining(["Medical", "Dental", "Vision", "Chiro"]));
  });

  it("resolves a known CaliforniaChoice Group Number and leaves an unknown number for review", () => {
    const pages = [{ pageNumber: 1, text: californiaChoiceLines.join("\n"), lines: californiaChoiceLines }];
    const inferred = interpretCaliforniaChoiceStatement(pages, [
      { id: 9, name: "Chimay Enterprise", groupNumber: "83746" },
    ]);
    const chimay = inferred?.preview.sheets[0]?.rows.filter((row) => row.values["Group Number"] === "83746") ?? [];
    const joses = inferred?.preview.sheets[0]?.rows.filter((row) => row.values["Group Number"] === "65884") ?? [];
    expect(chimay.every((row) => row.group.status === "matched" && row.group.groupId === 9)).toBe(true);
    expect(joses.every((row) => row.group.status === "new_group")).toBe(true);
  });

  it("does not change Choice Builder interpretation", () => {
    const pages = [{ pageNumber: 1, text: choiceBuilderStatementLines.join("\n"), lines: choiceBuilderStatementLines }];
    expect(interpretCaliforniaChoiceStatement(pages, [])).toBeNull();
    const interpreted = interpretExtractedPdfPages(pages, []);
    expect(interpreted?.preview.rowCount).toBe(6);
    expect(interpreted?.mapping.groupName).toBe("Company Name");
    expect(interpreted?.preview.sheets[0]?.rows.map((row) => row.values["Company Name"])).toEqual([
      "ACME PET RESORT",
      "ACME PET RESORT",
      "ACME PET RESORT",
      "ACME PET RESORT",
      "SMITH FARMS",
      "SMITH FARMS",
    ]);
  });
});
