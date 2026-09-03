import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { createAccountManager } from "./accountManagers";
import { createAgent } from "./agents";
import { createAllocation } from "./allocations";
import { createCarrier } from "./carriers";
import { createCommission } from "./commissions";
import { createGroup } from "./groups";
import { createLineOfBusiness } from "./linesOfBusiness";
import { exportReportDocument } from "./reportExport";
import { buildAgencyReport, buildIndividualReport, buildTeamReport } from "./reports";
import { createTeam } from "./teams";
import { createTestDb } from "@/db/test-db";
import { agencyReportDocument, printableReportHtml } from "@/domain/reportDocuments";

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

    const printable = await exportReportDocument(document, "pdf");
    expect(printable.contentType).toMatch(/html/);
    expect(String(printable.body)).toBe(printableReportHtml(document));
    expect(String(printable.body)).toMatch(/Murillo Insurance/);
    expect(String(printable.body)).toMatch(/Generated/);
  });
});
