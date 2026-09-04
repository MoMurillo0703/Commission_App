import { describe, expect, it } from "vitest";
import { choiceBuilderRealStructurePages } from "../../tests/helpers/choiceBuilderRealStructure";
import { mappingFieldLabels, mappingFields } from "./columnMapping";
import { parseFlexibleMonth } from "./dates";
import { candidateRowsFromPdfPages, lineCells, moneyToken } from "./pdfExtraction";
import { inferPdfStatementStructure, interpretExtractedPdfPages } from "./pdfStructureInference";
import { pdfIntakeSurface } from "./pdfIntakeSurface";

describe("Choice Builder real-structure regression", () => {
  it("preserves the real extractor header, policy, continuation, wrap, and adjustment shape", () => {
    const lines = choiceBuilderRealStructurePages.flatMap((page) => page.lines);
    expect(lines).toContain("Company Name    Paid Month    Product    Comm Amount    ADJ CD");
    expect(lines.some((line) => /^Policy Number: B\d{5}$/.test(line))).toBe(true);
    expect(lineCells("Aug 2026    Vision    ($0.89)")).toEqual(["Aug 2026", "Vision", "($0.89)"]);
    expect(moneyToken.test("($0.89)")).toBe(true);
    expect(lines).toContain("AGENCY");
    expect(lines).toContain("NAZARENE");
    expect(lines).toContain("LLC");
    expect(choiceBuilderRealStructurePages[1]?.lines[0]).toBe("Company Name    Paid Month    Product    Comm Amount    ADJ CD");
  });

  it("first-pass can count more rows while misaligning continuation names", () => {
    const firstPass = candidateRowsFromPdfPages(choiceBuilderRealStructurePages, []);
    expect(firstPass.rowCount).toBeGreaterThan(0);
    const misaligned = firstPass.sheets.some((sheet) =>
      sheet.rows.some((row) => parseFlexibleMonth(sheet.groupNameHeader ? row.values[sheet.groupNameHeader] ?? "" : "") != null),
    );
    expect(misaligned).toBe(true);
  });

  it("interprets the real structure into confirmation rows instead of mapping", () => {
    const interpreted = interpretExtractedPdfPages(choiceBuilderRealStructurePages, []);
    expect(interpreted?.inferred).toBe(true);
    expect(interpreted?.preview.rowCount).toBeGreaterThanOrEqual(26);
    expect(interpreted?.mapping).toMatchObject({
      groupName: "Company Name",
      groupNumber: "Policy Number",
      lineOfBusiness: "Product",
      premiumMonth: "Paid Month",
      grossCommission: "Comm Amount",
    });
    expect(interpreted?.mapping.premium).toBeFalsy();
    expect(interpreted?.mapping.agent).toBeFalsy();
    expect(mappingFields).not.toContain("agent");
    expect(Object.values(mappingFieldLabels)).not.toContain("Agent split %");

    const rows = interpreted?.preview.sheets.flatMap((sheet) => sheet.rows) ?? [];
    const acme = rows.filter((row) => row.values["Company Name"] === "ACME PET RESORT");
    expect(acme).toHaveLength(4);
    expect(acme.every((row) => row.values["Policy Number"] === "B10001")).toBe(true);
    expect(acme.map((row) => row.values.Product)).toEqual(["Dental", "Vision", "Dental", "Vision"]);
    expect(acme.map((row) => row.values["Comm Amount"])).toEqual(["$14.88", "$7.47", "$14.88", "$7.47"]);
    expect(acme.every((row) => row.group.status === "new_group")).toBe(true);

    const summit = rows.filter((row) => row.values["Company Name"] === "SUMMIT HEATING AND COOLING");
    expect(summit.map((row) => row.values["Comm Amount"])).toEqual(["$3.69", "$1.07"]);
    expect(summit.every((row) => row.values["Policy Number"] === "B10004")).toBe(true);

    const contracting = rows.find((row) => row.values["Comm Amount"] === "($0.89)");
    expect(contracting?.values["Company Name"]).toBe("H & R CONTRACTING INC");
    expect(contracting?.values.Product).toBe("Vision");
    expect(contracting?.values["Paid Month"]).toBe("Aug 2026");

    expect(rows.some((row) => row.values["Company Name"] === "LAKESIDE INSURANCE AGENCY")).toBe(true);
    expect(rows.some((row) => row.values["Company Name"] === "PINE DISTRICT CHURCH OF NAZARENE")).toBe(true);
    expect(rows.some((row) => row.values["Company Name"] === "WILLOW CREEK LAND AND CATTLE LLC")).toBe(true);
    expect(rows.every((row) => parseFlexibleMonth(row.values["Company Name"] ?? "") == null)).toBe(true);
    expect(rows.every((row) => !/TOTAL/i.test(row.values["Company Name"] ?? ""))).toBe(true);

    const surface = pdfIntakeSurface({
      status: "mapped",
      sourceType: "pdf",
      hasReadableRows: true,
      readyCount: interpreted?.preview.rowCount,
      blockedCount: interpreted?.preview.newGroupCount,
      statementCarrierName: "Choice Builder",
    });
    expect(surface.showMapping).toBe(false);
    expect(surface.showAgent).toBe(false);
    expect(surface.showAgentSplit).toBe(false);
    expect(surface.showCarrierMapping).toBe(false);
  });

  it("does not invent premium on Choice Builder rows", () => {
    const inferred = inferPdfStatementStructure(choiceBuilderRealStructurePages, []);
    expect(inferred?.mapping.premium).toBeFalsy();
    expect(inferred?.preview.sheets.flatMap((sheet) => sheet.rows).every((row) => !row.values.Premium)).toBe(true);
  });
});
