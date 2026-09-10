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

  it("maps deterministic Anthem MED/DENPPO/VIS codes to canonical LOBs and keeps the raw source label", () => {
    const anthemSheets = sheets.map((sheet) => ({
      ...sheet,
      rows: [
        { ...sheet.rows[0]!, values: { ...sheet.rows[0]!.values, LOB: "MED" } },
      ],
    }));
    const rows = validateMappedRows(anthemSheets, mapping, "2026-09", {
      ...references,
      carriers: [{ id: 3, name: "Anthem" }],
      linesOfBusiness: [{ id: 1, name: "MED" }, { id: 2, name: "Medical" }, { id: 3, name: "Dental" }],
      statementCarrier: { id: 3, name: "Anthem" },
    });
    expect(rows[0]?.paidMonth).toBe("2026-09");
    expect(rows[0]?.status).toBe("ready");
    expect(rows[0]?.lineOfBusinessId).toBe(2);
    expect(rows[0]?.lineOfBusinessLabel).toBe("Medical");
    expect(rows[0]?.importedLineName).toBe("MED");
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

  it("does not send impossible LOB values to review and treats ignore as skipped rows", () => {
    const garbageSheets = compensationSheets.map((sheet) => ({
      ...sheet,
      rows: sheet.rows.map((row) => ({ ...row, values: { ...row.values, LOB: "$" } })),
    }));
    const garbage = validateMappedRows(garbageSheets, compensationMapping, "2026-08", compensationRefs);
    expect(garbage[0]?.status).toBe("blocked");
    expect(garbage[0]?.exceptions.join(" ")).toMatch(/could not be read/);
    expect(garbage[0]?.exceptions.join(" ")).not.toMatch(/Unmatched line of business/);
    const ignoreSheets = compensationSheets.map((sheet) => ({
      ...sheet,
      rows: sheet.rows.map((row) => ({ ...row, values: { ...row.values, LOB: "PPO Dental" } })),
    }));
    const ignored = validateMappedRows(ignoreSheets, compensationMapping, "2026-08", {
      ...compensationRefs,
      lineResolutions: [{ key: "name:ppo dental", entityId: null, sourceName: "PPO Dental", action: "ignore" }],
    });
    expect(ignored[0]?.status).toBe("ignored");
    expect(ignored[0]?.lineOfBusinessId).toBeNull();
    expect(ignored[0]?.exceptions.join(" ")).toMatch(/ignored/i);
  });

  it("treats an ignored group as skipped instead of blocked", () => {
    const unmatchedSheets = compensationSheets.map((sheet) => ({
      ...sheet,
      rows: sheet.rows.map((row) => ({
        ...row,
        values: { ...row.values, "Group Name": "Skip Me" },
        group: { status: "new_group" as const, groupId: null, groupName: null, sourceName: "Skip Me", sourceNumber: null },
      })),
    }));
    const ignored = validateMappedRows(unmatchedSheets, compensationMapping, "2026-08", {
      ...compensationRefs,
      groupResolutions: [{ key: "name:skip me", groupId: null, sourceName: "Skip Me", sourceNumber: null, action: "ignore" }],
    });
    expect(ignored[0]?.status).toBe("ignored");
    expect(ignored[0]?.groupId).toBeNull();
    expect(ignored[0]?.exceptions.join(" ")).toMatch(/ignored/i);
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

  it("accepts named coverage months such as Aug 2026 without inventing values", () => {
    const namedMonthSheets: PreviewSheet[] = [{
      ...sheets[0]!,
      premiumMonthHeader: "Paid Month",
      rows: [{
        ...sheets[0]!.rows[0]!,
        values: { ...sheets[0]!.rows[0]!.values, "Paid Month": "Aug 2026" },
        premiumMonth: "Aug 2026",
      }],
    }];
    const [row] = validateMappedRows(namedMonthSheets, { ...mapping, premiumMonth: "Paid Month" }, "2026-09", {
      ...references,
      statementCarrier: { id: 9, name: "Choice Builder" },
    });
    expect(row?.premiumMonth).toBe("2026-08");
    expect(row?.exceptions.join(" ")).not.toMatch(/coverage month/i);
    const [invalid] = validateMappedRows(namedMonthSheets, { ...mapping, premiumMonth: "Paid Month" }, "2026-09", {
      ...references,
      statementCarrier: { id: 9, name: "Choice Builder" },
    });
    const badSheets: PreviewSheet[] = [{
      ...namedMonthSheets[0]!,
      rows: [{
        ...namedMonthSheets[0]!.rows[0]!,
        values: { ...namedMonthSheets[0]!.rows[0]!.values, "Paid Month": "Sometime Soon" },
        premiumMonth: "Sometime Soon",
      }],
    }];
    const [blocked] = validateMappedRows(badSheets, { ...mapping, premiumMonth: "Paid Month" }, "2026-09", {
      ...references,
      statementCarrier: { id: 9, name: "Choice Builder" },
    });
    expect(blocked?.premiumMonth).toBeNull();
    expect(blocked?.exceptions.join(" ")).toMatch(/coverage month/i);
    expect(invalid?.premiumMonth).toBe("2026-08");
  });

  it("keeps CaliforniaChoice row Paid Month as source notes and selects compensation by statement month", () => {
    const sheets: PreviewSheet[] = [{
      name: "Page 1",
      headerRowNumber: 1,
      rowCount: 1,
      headers: ["Group Number", "Company Name", "Paid Month", "Product", "Commission Amount", "Source context"],
      groupNameHeader: "Company Name",
      groupNumberHeader: "Group Number",
      premiumMonthHeader: null,
      rows: [{
        rowNumber: 1,
        values: {
          "Group Number": "83746",
          "Company Name": "CHIMAY ENTERPRISE L.L.C.",
          "Paid Month": "09-26",
          Product: "Medical",
          "Commission Amount": "$238.81",
          "Source context": "Carrier paid month: 09-26 · ADJ CD: CR",
        },
        premiumMonth: null,
        group: { status: "new_group", groupId: null, groupName: null, sourceName: "CHIMAY ENTERPRISE L.L.C.", sourceNumber: "83746" },
      }],
    }];
    const [row] = validateMappedRows(sheets, {
      groupName: "Company Name",
      groupNumber: "Group Number",
      lineOfBusiness: "Product",
      grossCommission: "Commission Amount",
      notes: "Source context",
    }, "2026-08", {
      groups: [{ id: 9, name: "Chimay Enterprise", groupNumber: "83746" }],
      carriers: [{ id: 4, name: "CaliforniaChoice" }],
      linesOfBusiness: [{ id: 3, name: "Medical" }],
      agents: [],
      statementCarrier: { id: 4, name: "CaliforniaChoice" },
      preferCarrierGroupIdentity: true,
      carrierGroupIdentities: [{ carrierId: 4, externalGroupNumber: "83746", groupId: 9 }],
      allocations: [{
        id: 1,
        groupId: 9,
        lineOfBusinessId: 3,
        effectiveStart: "2026-08",
        effectiveEnd: null,
        status: "active",
        entries: [{ recipientType: "agency", compensationBps: 10000 }],
      }, {
        id: 2,
        groupId: 9,
        lineOfBusinessId: 3,
        effectiveStart: "2026-09",
        effectiveEnd: null,
        status: "inactive",
        entries: [{ recipientType: "agency", compensationBps: 10000 }],
      }],
    });
    expect(row?.paidMonth).toBe("2026-08");
    expect(row?.premiumMonth).toBeNull();
    expect(row?.importedSourcePeriod).toBe("09-26");
    expect(row?.notes).toBe("Carrier paid month: 09-26 · ADJ CD: CR");
    expect(row?.groupId).toBe(9);
    expect(row?.grossCommissionCents).toBe(23881);
    expect(row?.exceptions.join(" ")).not.toMatch(/coverage month/i);
  });
});
