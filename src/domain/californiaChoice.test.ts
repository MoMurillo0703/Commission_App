import { describe, expect, it } from "vitest";
import { interpretExtractedPdfPages } from "./pdfStructureInference";
import { interpretCaliforniaChoiceStatement, looksLikeCaliforniaChoice, parseCaliforniaChoiceLines } from "./californiaChoice";
import { choiceBuilderStatementLines } from "../../tests/helpers/pdfFixtures";

export const californiaChoiceProductionShapeLines = [
  "Cal Choice Commission Statement",
  "GROUP NUMBER    COMPANY NAME    PAID MONTH    PRODUCT    PAID PREMIUM    COMM %    COMM AMOUNT    ADJ CD",
  "86216    BORGENS CONSTRUCTION INC    08-26    Medical    $    1,724.85    5.0    $    86.24",
  "09-26    Chiro    $    45.24    6.5    $    2.96",
  "09-26    Vision    $    61.80    12.0    $    7.42",
  "83746    CHIMAY ENTERPRISE LLC    09-26    Medical    $    4,776.34    5.0    $    238.81    CR",
  "09-26    Dental    $    120.00    5.0    $    6.00",
  "09-26    Dental    $    (10.00)    5.0    $    (0.50)    RV",
  "65884    JOSES ORNAMENTAL SUPPLY INC    05-26    Medical    $    800.00    5.0    $    40.00",
  "09-26    Vision    $    50.00    12.0    $    6.00",
  "09-26    Acupuncture    $    30.00    5.0    $    1.50",
];

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
  "CR",
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
  "09-26    Dental    ($10.00)    5.0    ($0.50)    RV",
  "09-26    Medical    $800.00    5.0    $40.00",
  "09-26    Vision    $50.00    12.0    $6.00",
];

describe("CaliforniaChoice continuation parsing", () => {
  it("carries Group Number and Company Name onto continuation LOB rows", () => {
    const rows = parseCaliforniaChoiceLines(californiaChoiceLines);
    expect(rows.map((row) => [row.groupNumber, row.groupName, row.product, row.commission, row.adjustmentCode])).toEqual([
      ["83746", "CHIMAY ENTERPRISE LLC", "Medical", "$238.81", "CR"],
      ["83746", "CHIMAY ENTERPRISE LLC", "Chiro", "$2.96", null],
      ["83746", "CHIMAY ENTERPRISE LLC", "Vision", "$7.42", null],
      ["65884", "JOSES ORNAMENTAL SUPPLY INC", "Dental", "$6.00", null],
      ["65884", "JOSES ORNAMENTAL SUPPLY INC", "Dental", "($0.50)", "RV"],
      ["65884", "JOSES ORNAMENTAL SUPPLY INC", "Medical", "$40.00", null],
      ["65884", "JOSES ORNAMENTAL SUPPLY INC", "Vision", "$6.00", null],
    ]);
    expect(rows[0]).toMatchObject({ paidMonthSource: "09-26", premium: "$4,776.34", rate: "5.0" });
    expect(rows[4]?.commission).toBe("($0.50)");
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
    ], {
      carrierId: 4,
      identities: [{ carrierId: 4, externalGroupNumber: "83746", groupId: 9 }],
    });
    const chimay = inferred?.preview.sheets[0]?.rows.filter((row) => row.values["Group Number"] === "83746") ?? [];
    const joses = inferred?.preview.sheets[0]?.rows.filter((row) => row.values["Group Number"] === "65884") ?? [];
    expect(chimay.every((row) => row.group.status === "matched" && row.group.groupId === 9)).toBe(true);
    expect(joses.every((row) => row.group.status === "new_group")).toBe(true);
    expect(inferred?.mapping.premiumMonth).toBeUndefined();
    expect(inferred?.preview.sheets[0]?.rows.every((row) => row.premiumMonth == null)).toBe(true);
    expect(inferred?.preview.sheets[0]?.rows[0]?.values["Paid Month"]).toBe("09-26");
    expect(inferred?.preview.sheets[0]?.rows[0]?.values["Source context"]).toContain("Carrier paid month: 09-26");
    expect(inferred?.preview.sheets[0]?.rows[0]?.values["ADJ CD"]).toBe("CR");
    expect(inferred?.preview.sheets[0]?.rows[4]?.values["ADJ CD"]).toBe("RV");
    expect(inferred?.preview.sheets[0]?.rows[4]?.values["Commission Amount"]).toBe("($0.50)");
  });

  it("does not treat groups.group_number as CaliforniaChoice identity", () => {
    const pages = [{ pageNumber: 1, text: californiaChoiceLines.join("\n"), lines: californiaChoiceLines }];
    const inferred = interpretCaliforniaChoiceStatement(pages, [
      { id: 9, name: "Chimay Enterprise", groupNumber: "83746" },
    ], { carrierId: 4, identities: [] });
    expect(inferred?.preview.sheets[0]?.rows.every((row) => row.group.status === "new_group")).toBe(true);
  });

  it("detects Cal Choice filenames and parses tabular rows with standalone $ tokens", () => {
    const pages = [{
      pageNumber: 1,
      text: californiaChoiceProductionShapeLines.join("\n"),
      lines: californiaChoiceProductionShapeLines,
    }];
    expect(looksLikeCaliforniaChoice(pages)).toBe(true);
    expect(looksLikeCaliforniaChoice([{ pageNumber: 1, text: "", lines: ["GROUP NUMBER", "86216"] }], "Cal Choice - 08 2026.pdf")).toBe(true);
    const inferred = interpretCaliforniaChoiceStatement(pages, []);
    const products = inferred?.preview.sheets[0]?.rows.map((row) => row.values.Product) ?? [];
    const months = inferred?.preview.sheets[0]?.rows.map((row) => row.values["Paid Month"]) ?? [];
    const unmatchedLobs = products.filter((product) => product === "$" || /^(0?[1-9]|1[0-2])-\d{2}$/.test(product ?? ""));
    expect(unmatchedLobs).toEqual([]);
    expect(products).toEqual([
      "Medical", "Chiro", "Vision", "Medical", "Dental", "Dental", "Medical", "Vision", "Acupuncture",
    ]);
    expect(months).toEqual(["08-26", "09-26", "09-26", "09-26", "09-26", "09-26", "05-26", "09-26", "09-26"]);
    expect(inferred?.preview.sheets[0]?.rows.map((row) => row.values["Company Name"])).toEqual([
      "BORGENS CONSTRUCTION INC",
      "BORGENS CONSTRUCTION INC",
      "BORGENS CONSTRUCTION INC",
      "CHIMAY ENTERPRISE LLC",
      "CHIMAY ENTERPRISE LLC",
      "CHIMAY ENTERPRISE LLC",
      "JOSES ORNAMENTAL SUPPLY INC",
      "JOSES ORNAMENTAL SUPPLY INC",
      "JOSES ORNAMENTAL SUPPLY INC",
    ]);
    expect(inferred?.preview.sheets[0]?.rows[5]?.values["Commission Amount"]).toBe("(0.50)");
    expect(inferred?.preview.sheets[0]?.rows[5]?.values["ADJ CD"]).toBe("RV");
    expect(inferred?.preview.sheets[0]?.rows[3]?.values["ADJ CD"]).toBe("CR");
    expect(inferred?.preview.sheets[0]?.rows.every((row) => row.premiumMonth == null)).toBe(true);
    expect(inferred?.mapping).toMatchObject({
      lineOfBusiness: "Product",
      grossCommission: "Commission Amount",
      premium: "Paid Premium",
    });
    expect(inferred?.mapping.premiumMonth).toBeUndefined();
    expect(inferred?.preview.pdf?.groupMatchStrategy).toBe("carrier_group_identity");
  });

  it("parses single-space tabular rows and stacked dollar tokens without shifting Product", () => {
    const rows = parseCaliforniaChoiceLines([
      "86216 BORGENS CONSTRUCTION INC 08-26 Medical $ 1,724.85 5.0 $ 86.24",
      "09-26 Chiro $ 45.24 6.5 $ 2.96",
      "83746",
      "CHIMAY ENTERPRISE LLC",
      "09-26",
      "Medical",
      "$",
      "4,776.34",
      "5.0",
      "$",
      "238.81",
      "CR",
    ]);
    expect(rows).toEqual([
      expect.objectContaining({
        groupNumber: "86216",
        groupName: "BORGENS CONSTRUCTION INC",
        paidMonthSource: "08-26",
        product: "Medical",
        premium: "1,724.85",
        rate: "5.0",
        commission: "86.24",
      }),
      expect.objectContaining({
        groupNumber: "86216",
        groupName: "BORGENS CONSTRUCTION INC",
        paidMonthSource: "09-26",
        product: "Chiro",
        commission: "2.96",
      }),
      expect.objectContaining({
        groupNumber: "83746",
        groupName: "CHIMAY ENTERPRISE LLC",
        paidMonthSource: "09-26",
        product: "Medical",
        premium: "4,776.34",
        rate: "5.0",
        commission: "238.81",
        adjustmentCode: "CR",
      }),
    ]);
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
