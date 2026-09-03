import { describe, expect, it } from "vitest";
import { resolveImportedCarrier, validateMappedRows } from "./importRows";
import type { PreviewSheet } from "./workbook";

const mapping = {
  groupName: "Group Name",
  carrier: "Carrier",
  lineOfBusiness: "LOB",
  grossCommission: "Commission",
};

const sheets: PreviewSheet[] = [
  {
    name: "Commissions",
    headerRowNumber: 1,
    rowCount: 1,
    headers: ["Group Name", "Carrier", "LOB", "Commission"],
    groupNameHeader: "Group Name",
    groupNumberHeader: null,
    premiumMonthHeader: null,
    rows: [
      {
        rowNumber: 2,
        values: { "Group Name": "Acme Benefits", Carrier: "", LOB: "Dental", Commission: "80.00" },
        premiumMonth: null,
        group: {
          status: "matched",
          groupId: 1,
          groupName: "Acme Benefits",
          sourceName: "Acme Benefits",
          sourceNumber: null,
        },
      },
    ],
  },
];

const references = {
  groups: [{ id: 1, name: "Acme Benefits", groupNumber: "A1" }],
  carriers: [{ id: 9, name: "Principal" }, { id: 10, name: "Aetna" }],
  linesOfBusiness: [{ id: 3, name: "Dental" }],
  agents: [],
  statementCarrier: { id: 9, name: "Principal" },
};

describe("statement-level carrier row resolution", () => {
  it("uses the statement carrier when the row has no carrier value", () => {
    const match = resolveImportedCarrier(mapping, { Carrier: "" }, references.carriers, references.statementCarrier);
    expect(match).toMatchObject({ status: "matched", id: 9, name: "Principal" });
  });

  it("does not force the statement carrier when a row names a different carrier", () => {
    const match = resolveImportedCarrier(mapping, { Carrier: "Aetna" }, references.carriers, references.statementCarrier);
    expect(match).toMatchObject({ status: "matched", id: 10, name: "Aetna" });
  });

  it("leaves unmatched row-level carrier names unmatched", () => {
    const match = resolveImportedCarrier(mapping, { Carrier: "Unknown Mutual" }, references.carriers, references.statementCarrier);
    expect(match).toMatchObject({ status: "unmatched", id: null, source: "Unknown Mutual" });
  });

  it("lets a statement carrier satisfy imported rows without a mapped carrier column", () => {
    const rows = validateMappedRows(
      sheets,
      { groupName: "Group Name", lineOfBusiness: "LOB", grossCommission: "Commission" },
      "2026-08",
      references,
    );
    expect(rows[0]?.status).toBe("ready");
    expect(rows[0]?.carrierId).toBe(9);
    expect(rows[0]?.carrierLabel).toBe("Principal");
  });
});
