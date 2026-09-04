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
    expect(match).toMatchObject({ status: "matched", id: 9, name: "Principal", sourceKind: "statement" });
  });

  it("does not force the statement carrier when a row names a different carrier", () => {
    const match = resolveImportedCarrier(mapping, { Carrier: "Aetna" }, references.carriers, references.statementCarrier);
    expect(match).toMatchObject({ status: "matched", id: 10, name: "Aetna", sourceKind: "column" });
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
    expect(rows[0]?.carrierSource).toBe("statement");
    expect(rows[0]?.exceptions.join(" ")).not.toMatch(/carrier/i);
  });

  it("applies a confirmed carrier coverage alias only for that carrier", () => {
    const visSheets = sheets.map((sheet) => ({
      ...sheet,
      rows: sheet.rows.map((row) => ({ ...row, values: { ...row.values, LOB: "VIS" } })),
    }));
    const aliases = [{ carrierId: 1, sourceValue: "vis", lineOfBusinessId: 20 }];
    const lines = [{ id: 20, name: "Group Vision" }];
    const anthem = validateMappedRows(visSheets, mapping, "2026-08", {
      ...references,
      carriers: [{ id: 1, name: "Anthem" }],
      linesOfBusiness: lines,
      statementCarrier: { id: 1, name: "Anthem" },
      carrierCoverageAliases: aliases,
    });
    expect(anthem[0]?.status).toBe("ready");
    expect(anthem[0]?.lineOfBusinessId).toBe(20);
    expect(anthem[0]?.lineOfBusinessLabel).toBe("Group Vision");
    const otherCarrier = validateMappedRows(visSheets, mapping, "2026-08", {
      ...references,
      linesOfBusiness: lines,
      carrierCoverageAliases: aliases,
    });
    expect(otherCarrier[0]?.status).toBe("blocked");
    expect(otherCarrier[0]?.exceptions.join(" ")).toMatch(/Unmatched line of business/);
  });
});

const compensationSheets: PreviewSheet[] = [
  {
    name: "Commissions",
    headerRowNumber: 1,
    rowCount: 1,
    headers: ["Group Name", "Carrier", "LOB", "Agent", "Commission", "Split", "Premium Month"],
    groupNameHeader: "Group Name",
    groupNumberHeader: null,
    premiumMonthHeader: "Premium Month",
    rows: [
      {
        rowNumber: 2,
        values: {
          "Group Name": "Acme Benefits",
          Carrier: "Principal",
          LOB: "Dental",
          Agent: "Alex Morgan",
          Commission: "80.00",
          Split: "90",
          "Premium Month": "2026-05",
        },
        premiumMonth: "2026-05",
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

const compensationMapping = {
  groupName: "Group Name",
  carrier: "Carrier",
  lineOfBusiness: "LOB",
  agent: "Agent",
  grossCommission: "Commission",
  compensationPercent: "Split",
  premiumMonth: "Premium Month",
};

const compensationRefs = {
  groups: [{ id: 1, name: "Acme Benefits", groupNumber: "A1", defaultCompensationBps: 3000 }],
  carriers: [{ id: 9, name: "Principal" }],
  linesOfBusiness: [{ id: 3, name: "Dental" }],
  agents: [{ id: 5, name: "Alex Morgan", defaultCompensationBps: 4000 }],
};

describe("statement compensation from agreements", () => {
  it("ignores a mapped source split column and unused agent/group defaults", () => {
    const rows = validateMappedRows(compensationSheets, compensationMapping, "2026-08", compensationRefs);
    expect(rows[0]?.status).toBe("ready");
    expect(rows[0]?.compensationBps).toBe(0);
  });

  it("uses saved line and agent resolutions so unmatched names can proceed after review", () => {
    const unmatchedSheets = compensationSheets.map((sheet) => ({
      ...sheet,
      rows: sheet.rows.map((row) => ({ ...row, values: { ...row.values, LOB: "PPO Dental", Agent: "Pat Lee" } })),
    }));
    const unmatched = validateMappedRows(unmatchedSheets, compensationMapping, "2026-08", compensationRefs);
    expect(unmatched[0]?.status).toBe("blocked");
    expect(unmatched[0]?.exceptions.join(" ")).toMatch(/Unmatched line of business/);
    expect(unmatched[0]?.exceptions.join(" ")).toMatch(/Unmatched agent/);
    const resolved = validateMappedRows(unmatchedSheets, compensationMapping, "2026-08", {
      ...compensationRefs,
      lineResolutions: [{ key: "name:ppo dental", entityId: 3, sourceName: "PPO Dental", action: "match" }],
      agentResolutions: [{ key: "name:pat lee", entityId: 5, sourceName: "Pat Lee", action: "create" }],
    });
    expect(resolved[0]?.status).toBe("ready");
    expect(resolved[0]?.lineOfBusinessId).toBe(3);
    expect(resolved[0]?.agentId).toBe(5);
    expect(resolved[0]?.importedLineName).toBe("PPO Dental");
    expect(resolved[0]?.importedAgentName).toBe("Pat Lee");
  });

  it("uses the Group + Agent + LOB agreement selected by paid month, not premium month", () => {
    const agreements = [
      { id: 1, groupId: 1, agentId: 5, lineOfBusinessId: 3, compensationBps: 4000, effectiveStart: "2026-01", effectiveEnd: "2026-06", status: "active" as const },
      { id: 2, groupId: 1, agentId: 5, lineOfBusinessId: 3, compensationBps: 2500, effectiveStart: "2026-07", effectiveEnd: null, status: "active" as const },
    ];
    const july = validateMappedRows(compensationSheets, compensationMapping, "2026-05", { ...compensationRefs, agreements });
    const august = validateMappedRows(compensationSheets, compensationMapping, "2026-08", { ...compensationRefs, agreements });
    expect(july[0]?.premiumMonth).toBe("2026-05");
    expect(july[0]?.compensationBps).toBe(4000);
    expect(august[0]?.premiumMonth).toBe("2026-05");
    expect(august[0]?.compensationBps).toBe(2500);
  });
});
