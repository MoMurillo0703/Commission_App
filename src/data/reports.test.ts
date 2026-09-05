import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { createAccountManager } from "./accountManagers";
import { createAgent } from "./agents";
import { createAllocation } from "./allocations";
import { createCarrier } from "./carriers";
import { createCommission } from "./commissions";
import { createGroup } from "./groups";
import { createLineOfBusiness } from "./linesOfBusiness";
import { postImportStatement } from "./importPosting";
import { exportReportDocument } from "./reportExport";
import { buildAgencyReport, buildIndividualReport, buildTeamReport } from "./reports";
import { createImportStatement } from "./statements";
import { createTeam } from "./teams";
import { createTestDb } from "@/db/test-db";
import { agencyReportDocument, individualReportDocument } from "@/domain/reportDocuments";
import { fingerprintBuffer } from "@/domain/fingerprint";
import { previewWorkbook } from "@/domain/workbook";

async function seed() {
  const db = await createTestDb();
  const john = await createAgent(db, { name: "John Elizando" });
  const nancy = await createAgent(db, { name: "Nancy" });
  const laura = await createAccountManager(db, { name: "Laura Montoya" });
  const group = await createGroup(db, { name: "H R LABOR CONTRACTING", primaryAgentId: john.id, accountManagerId: laura.id });
  const carrier = await createCarrier(db, { name: "Choice Builder" });
  const medical = await createLineOfBusiness(db, { name: "Group Medical" });
  const dental = await createLineOfBusiness(db, { name: "Dental" });
  const team = await createTeam(db, {
    name: "Central Valley Team",
    members: [
      { personKind: "account_manager", personId: laura.id, shareBps: 5000, effectiveStart: "2026-01" },
      { personKind: "agent", personId: nancy.id, shareBps: 5000, effectiveStart: "2026-01" },
    ],
  });
  await createAllocation(db, {
    groupId: group.id,
    lineOfBusinessId: medical.id,
    effectiveStart: "2026-09",
    entries: [
      { recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 7000 },
      { recipientType: "agency", compensationBps: 2000 },
      { recipientType: "team", teamId: team.id, compensationBps: 1000 },
    ],
  });
  await createCommission(db, {
    statementMonth: "2026-09",
    groupId: group.id,
    carrierId: carrier.id,
    lineOfBusinessId: medical.id,
    grossCommissionCents: 10000,
    premiumCents: 100000,
  });
  await createCommission(db, {
    statementMonth: "2026-10",
    groupId: group.id,
    carrierId: carrier.id,
    lineOfBusinessId: dental.id,
    grossCommissionCents: 5000,
  });
  return { db, john, nancy, laura, group, carrier, medical, dental, team };
}

describe("posted commission reports", () => {
  it("totals the agency report and filters by paid month, group, carrier, and LOB", async () => {
    const { db, group, carrier, medical } = await seed();
    const all = await buildAgencyReport(db, { kind: "agency" });
    expect(all.filters.paidMonth).toBeNull();
    expect(all.availability.postedCommissionCount).toBe(2);
    expect(all.availability.availablePaidMonths).toEqual(["2026-09", "2026-10"]);
    expect(all.totals.grossCommissionCents).toBe(15000);
    expect(all.totals.agencyNetCents).toBe(7000);
    expect(all.totals.compensationDistributedCents).toBe(8000);

    const september = await buildAgencyReport(db, { kind: "agency", paidMonth: "2026-09" });
    expect(september.rows).toHaveLength(1);
    expect(september.totals.agencyNetCents).toBe(2000);
    expect(september.totals.premiumCents).toBe(100000);

    const filtered = await buildAgencyReport(db, {
      kind: "agency",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
    });
    expect(filtered.rows.every((row) => row.lineOfBusinessName === "Group Medical")).toBe(true);
    expect(filtered.totals.grossCommissionCents).toBe(10000);

    const emptyMonth = await buildAgencyReport(db, { kind: "agency", paidMonth: "2025-01" });
    expect(emptyMonth.rows).toHaveLength(0);
    expect(emptyMonth.availability.postedCommissionCount).toBe(2);
    expect(emptyMonth.availability.availablePaidMonths).toContain("2026-09");
  });

  it("uses posted allocation snapshots for individual and team reports", async () => {
    const { db, john, team } = await seed();
    const individual = await buildIndividualReport(db, {
      kind: "individual",
      paidMonth: "2026-09",
      personKind: "agent",
      personId: john.id,
    });
    expect(individual.totals.compensationCents).toBe(7000);
    expect(individual.rows[0]?.allocationBps).toBe(7000);

    const teamReport = await buildTeamReport(db, { kind: "team", teamId: team.id, paidMonth: "2026-09" });
    expect(teamReport.totals.teamCompensationCents).toBe(1000);
    expect(teamReport.totals.memberCompensationCents).toBe(1000);
    expect(teamReport.rows.map((row) => row.memberName).sort()).toEqual(["Laura Montoya", "Nancy"]);
  });

  it("exports CSV, XLSX, and a printable/PDF HTML report", async () => {
    const { db } = await seed();
    const report = await buildAgencyReport(db, { kind: "agency", paidMonth: "2026-09" });
    const document = agencyReportDocument(report.rows, report.totals, report.filters, report.names);
    const csv = await exportReportDocument(document, "csv");
    expect(String(csv.body)).toMatch(/Agency Commission Report/);
    expect(String(csv.body)).toMatch(/H R LABOR CONTRACTING/);

    const xlsx = await exportReportDocument(document, "xlsx");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(xlsx.body as Uint8Array) as unknown as Parameters<ExcelJS.Xlsx["load"]>[0]);
    const text = workbook.worksheets[0]?.getSheetValues().flat().join(" ") ?? "";
    expect(text).toMatch(/Murillo Insurance/);
    expect(text).toMatch(/Total Agency Net/);

    const printable = await exportReportDocument(document, "print");
    expect(printable.contentType).toMatch(/html/);
    expect(String(printable.body)).toMatch(/Murillo Insurance/);
    expect(String(printable.body)).toMatch(/Generated/);

    const pdf = await exportReportDocument(document, "pdf");
    expect(pdf.contentType).toBe("application/pdf");
    expect(pdf.filename).toMatch(/\.pdf$/);
    expect(Buffer.from(pdf.body as Uint8Array).subarray(0, 4).toString()).toBe("%PDF");
    expect(document.totals.map((total) => total.value)).toEqual([
      ...agencyReportDocument(report.rows, report.totals, report.filters, report.names).totals.map((total) => total.value),
    ]);
  });

  it("aggregates three posted statements into one recipient payable statement", async () => {
    const db = await createTestDb();
    const john = await createAgent(db, { name: "John Elizando" });
    const groupA = await createGroup(db, { name: "Acme Benefits", groupNumber: "A1", primaryAgentId: john.id });
    const groupB = await createGroup(db, { name: "Beta Health", groupNumber: "B1", primaryAgentId: john.id });
    const carrier = await createCarrier(db, { name: "Principal" });
    const dental = await createLineOfBusiness(db, { name: "Dental" });
    await createAllocation(db, {
      groupId: groupA.id,
      lineOfBusinessId: dental.id,
      effectiveStart: "2026-08",
      entries: [
        { recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 7000 },
        { recipientType: "agency", compensationBps: 3000 },
      ],
    });
    await createAllocation(db, {
      groupId: groupB.id,
      lineOfBusinessId: dental.id,
      effectiveStart: "2026-08",
      entries: [
        { recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 4000 },
        { recipientType: "agency", compensationBps: 6000 },
      ],
    });

    const mapping = {
      groupName: "Group Name",
      groupNumber: "Group Number",
      carrier: "Carrier",
      lineOfBusiness: "LOB",
      agent: null,
      premium: "Premium",
      grossCommission: "Commission",
      premiumMonth: null,
    };
    async function postStatement(fileName: string, rows: string[][]) {
      const book = new ExcelJS.Workbook();
      const sheet = book.addWorksheet("Commissions");
      sheet.addRow(["Group Name", "Group Number", "Carrier", "LOB", "Premium", "Commission"]);
      for (const row of rows) sheet.addRow(row);
      const buffer = new Uint8Array(await book.xlsx.writeBuffer());
      const statement = await createImportStatement(db, {
        originalFilename: fileName,
        paidMonth: "2026-08",
        carrierId: carrier.id,
        sourceType: "excel",
        status: "ready_to_map",
        fingerprint: fingerprintBuffer(buffer),
        preview: await previewWorkbook(buffer, [groupA, groupB]),
      });
      return postImportStatement(db, statement.id, mapping);
    }

    const first = await postStatement("carrier-a.xlsx", [["Acme Benefits", "A1", "Principal", "Dental", "1000.00", "100.00"]]);
    const second = await postStatement("carrier-b.xlsx", [["Acme Benefits", "A1", "Principal", "Dental", "500.00", "50.00"]]);
    const third = await postStatement("carrier-c.xlsx", [["Beta Health", "B1", "Principal", "Dental", "250.00", "25.00"]]);
    expect(first.postedCount + second.postedCount + third.postedCount).toBe(3);

    const statement = await buildIndividualReport(db, {
      kind: "recipient",
      paidMonth: "2026-08",
      personKind: "agent",
      personId: john.id,
    });
    expect(statement.filters.kind).toBe("recipient");
    expect(statement.payable?.payableReady).toBe(true);
    expect(statement.totals.compensationCents).toBe(11500);
    expect(statement.rows.map((row) => row.commissionId).filter(Boolean)).toHaveLength(3);
    expect(statement.rows.reduce((sum, row) => sum + row.grossCommissionCents, 0)).toBe(17500);

    const document = individualReportDocument(
      statement.rows,
      statement.totals,
      statement.filters,
      statement.names,
      "John Elizando",
    );
    expect(document.title).toBe("Commission Statement");
    expect(document.totals[1]?.label).toBe("TOTAL PAYABLE TO RECIPIENT");
    expect(document.totals[1]?.value).toBe("$115.00");
    expect(document.notes?.join(" ")).toMatch(/does not mean the recipient has been paid/);
    expect(document.sourceCommissionIds).toEqual(statement.rows.map((row) => row.commissionId).sort((left, right) => (left ?? 0) - (right ?? 0)));

    const pdf = await exportReportDocument(document, "pdf");
    expect(pdf.contentType).toBe("application/pdf");
    const { extractText, getDocumentProxy } = await import("unpdf");
    const parsed = await getDocumentProxy(new Uint8Array(pdf.body as Uint8Array));
    const extracted = await extractText(parsed, { mergePages: true });
    const text = Array.isArray(extracted.text) ? extracted.text.join(" ") : extracted.text;
    expect(text).toMatch(/Commission Statement/);
    expect(text).toMatch(/John Elizando|TOTAL PAYABLE/i);
  });

  it("does not call a recipient statement payable-ready when assigned-group commissions lack an allocation", async () => {
    const db = await createTestDb();
    const john = await createAgent(db, { name: "John Elizando" });
    const group = await createGroup(db, { name: "Need Plan", primaryAgentId: john.id });
    const carrier = await createCarrier(db, { name: "Principal" });
    const dental = await createLineOfBusiness(db, { name: "Dental" });
    await createCommission(db, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 8000,
    });
    const report = await buildIndividualReport(db, {
      kind: "recipient",
      paidMonth: "2026-08",
      personKind: "agent",
      personId: john.id,
    });
    expect(report.payable?.payableReady).toBe(false);
    expect(report.payable?.message).toMatch(/no complete allocation/);
    expect(report.rows).toHaveLength(0);
    expect(report.matchingCommissionCount).toBe(1);
    expect(report.names.personName).toBe("John Elizando");
  });

  it("uses stored Agent and Account Manager payout identities and names", async () => {
    const { db, john, laura } = await seed();
    const agent = await buildIndividualReport(db, {
      kind: "recipient",
      paidMonth: "2026-09",
      personKind: "agent",
      personId: john.id,
    });
    expect(agent.names.personName).toBe("John Elizando");
    expect(agent.rows[0]?.recipientName).toBe("John Elizando");
    expect(agent.rows.every((row) => row.personKind === "agent" && row.personId === john.id)).toBe(true);

    const manager = await buildIndividualReport(db, {
      kind: "recipient",
      paidMonth: "2026-09",
      personKind: "account_manager",
      personId: laura.id,
    });
    expect(manager.names.personName).toBe("Laura Montoya");
    expect(manager.rows[0]?.recipientName).toBe("Laura Montoya");
    expect(manager.rows.every((row) => row.personKind === "account_manager")).toBe(true);
  });

  it("adds direct and team-member payouts for the same person and excludes the team parent", async () => {
    const db = await createTestDb();
    const john = await createAgent(db, { name: "John Elizando" });
    const nancy = await createAgent(db, { name: "Nancy" });
    const group = await createGroup(db, { name: "Split Group", primaryAgentId: john.id });
    const carrier = await createCarrier(db, { name: "Principal" });
    const dental = await createLineOfBusiness(db, { name: "Dental" });
    const team = await createTeam(db, {
      name: "Valley",
      members: [
        { personKind: "agent", personId: john.id, shareBps: 5000, effectiveStart: "2026-01" },
        { personKind: "agent", personId: nancy.id, shareBps: 5000, effectiveStart: "2026-01" },
      ],
    });
    await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: dental.id,
      effectiveStart: "2026-08",
      entries: [
        { recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 5000 },
        { recipientType: "team", teamId: team.id, compensationBps: 2000 },
        { recipientType: "agency", compensationBps: 3000 },
      ],
    });
    await createCommission(db, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 10000,
    });
    const report = await buildIndividualReport(db, {
      kind: "recipient",
      paidMonth: "2026-08",
      personKind: "agent",
      personId: john.id,
    });
    expect(report.totals.compensationCents).toBe(6000);
    expect(report.rows).toHaveLength(2);
    expect(report.rows.map((row) => row.compensationCents).sort((left, right) => left - right)).toEqual([1000, 5000]);
    expect(report.totals.grossCommissionCents).toBe(10000);
  });

  it("includes negative payouts and treats a net-zero snapshot as legitimate zero", async () => {
    const db = await createTestDb();
    const john = await createAgent(db, { name: "John Elizando" });
    const group = await createGroup(db, { name: "Chargeback Group", primaryAgentId: john.id });
    const carrier = await createCarrier(db, { name: "Principal" });
    const dental = await createLineOfBusiness(db, { name: "Dental" });
    await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: dental.id,
      effectiveStart: "2026-08",
      entries: [
        { recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 },
      ],
    });
    await createCommission(db, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 5000,
    });
    await createCommission(db, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: -5000,
    });
    const report = await buildIndividualReport(db, {
      kind: "recipient",
      paidMonth: "2026-08",
      personKind: "agent",
      personId: john.id,
    });
    expect(report.rows).toHaveLength(2);
    expect(report.totals.compensationCents).toBe(0);
    expect(report.rows.some((row) => row.compensationCents < 0)).toBe(true);
  });
});
