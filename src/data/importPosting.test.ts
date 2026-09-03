import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAgreement, listAgreements } from "./agreements";
import { createAgent } from "./agents";
import { createCarrier, listCarriers } from "./carriers";
import { listCommissions } from "./commissions";
import { createGroup, listGroups } from "./groups";
import { postImportStatement, previewImportPosting } from "./importPosting";
import { createLineOfBusiness } from "./linesOfBusiness";
import { createImportStatement } from "./statements";
import { createTestDb } from "@/db/test-db";
import { suggestColumnMapping, type ColumnMapping } from "@/domain/columnMapping";
import { fingerprintBuffer } from "@/domain/fingerprint";
import { previewCsv, previewWorkbook } from "@/domain/workbook";

const mapping: ColumnMapping = {
  groupName: "Group Name",
  groupNumber: "Group Number",
  carrier: "Carrier",
  lineOfBusiness: "LOB",
  agent: "Agent",
  premium: "Premium",
  grossCommission: "Commission",
  premiumMonth: "Premium Month",
};

async function workbook(rows: string[][]) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Commissions");
  sheet.addRow(["Group Name", "Group Number", "Carrier", "LOB", "Agent", "Premium", "Commission", "Split", "Premium Month"]);
  for (const row of rows) sheet.addRow(row);
  return new Uint8Array(await book.xlsx.writeBuffer());
}

async function seed() {
  const db = await createTestDb();
  const group = await createGroup(db, { name: "Acme Benefits", groupNumber: "A1" });
  const carrier = await createCarrier(db, { name: "Principal" });
  const lineOfBusiness = await createLineOfBusiness(db, { name: "Dental" });
  const agent = await createAgent(db, { name: "Alex Morgan", defaultCompensationBps: 4000 });
  return { db, group, carrier, lineOfBusiness, agent };
}

async function savedStatement(
  db: Awaited<ReturnType<typeof createTestDb>>,
  rows: string[][],
  paidMonth = "2026-08",
  carrierId?: number,
) {
  const buffer = await workbook(rows);
  return await createImportStatement(db, {
    originalFilename: "principal.xlsx",
    paidMonth,
    carrierId: carrierId ?? null,
    sourceType: "excel",
    status: "ready_to_map",
    fingerprint: fingerprintBuffer(buffer),
    preview: await previewWorkbook(buffer, await listGroups(db)),
  });
}

describe("excel row posting", () => {
  it("posts an Anthem-layout CSV without treating the carrier split as agent compensation", async () => {
    const { db, group, carrier, lineOfBusiness, agent } = await seed();
    await createAgreement(db, { groupId: group.id, agentId: agent.id, lineOfBusinessId: lineOfBusiness.id, compensationBps: 4000, effectiveStart: "2026-01" });
    const csv = [
      "Agency,,,,TOTAL PREMIUM RECEIVED THIS MONTH,,1000.00",
      "Address,,,,STATEMENT OF ACCOUNT",
      "City,,,,PERIOD ENDING :07/31/2026",
      "",
      "TRACKING CODE,PRODUCER NAME,PRODUCT TYPE,NAME / GROUP NAME,SPLIT % AMT,DUE DATE,PREMIUM RECEIVED,CURRENT COMMISSION,COMMENTS",
      ",Alex Morgan,Dental,Acme Benefits,100.0,07/01/2026,793.86,79.38,REINSTATE",
    ].join("\n");
    const buffer = new TextEncoder().encode(csv);
    const preview = previewCsv(buffer, await listGroups(db));
    const statement = await createImportStatement(db, { originalFilename: "anthem.csv", paidMonth: "2026-08", carrierId: carrier.id, sourceType: "csv", status: "ready_to_map", fingerprint: fingerprintBuffer(buffer), preview });
    const anthemMapping = suggestColumnMapping(preview.sheets[0].headers);

    expect(anthemMapping).not.toHaveProperty("compensationPercent");
    expect((await postImportStatement(db, statement.id, anthemMapping)).postedCount).toBe(1);
    const [row] = await listCommissions(db);
    expect(row.statementMonth).toBe("2026-08");
    expect(row.premiumMonth).toBe("2026-07");
    expect(row.grossCommissionCents).toBe(7938);
    expect(row.compensationBps).toBe(4000);
    expect(row.agentCompensationCents).toBe(3175);
    expect(row.agencyNetCents).toBe(4763);
  });

  it("ignores a source split column and uses the agreement selected by paid month", async () => {
    const { db, group, agent, lineOfBusiness } = await seed();
    await createAgreement(db, {
      groupId: group.id,
      agentId: agent.id,
      lineOfBusinessId: lineOfBusiness.id,
      compensationBps: 4000,
      effectiveStart: "2026-08",
    });
    const statement = await savedStatement(db, [
      ["Acme Benefits", "A1", "Principal", "Dental", "Alex Morgan", "10000.00", "500.00", "90", "2026-07"],
    ]);

    const posted = await postImportStatement(db, statement.id, mapping);
    const [row] = await listCommissions(db);

    expect(posted.postedCount).toBe(1);
    expect(row.statementMonth).toBe("2026-08");
    expect(row.premiumMonth).toBe("2026-07");
    expect(row.grossCommissionCents).toBe(50000);
    expect(row.compensationBps).toBe(4000);
    expect(row.agentCompensationCents).toBe(20000);
    expect(row.agencyNetCents).toBe(30000);
    expect(row.importStatementId).toBe(statement.id);
    expect(row.sourceRowKey).toBe("Commissions:2");
  });

  it("blocks unmatched groups and does not create them", async () => {
    const { db } = await seed();
    const statement = await savedStatement(db, [
      ["Empower Speech", "ES-9", "Principal", "Dental", "Alex Morgan", "1000.00", "80.00", "40", "2026-07"],
    ]);

    const preview = await previewImportPosting(db, statement.id, mapping);
    expect(preview.rows[0]?.status).toBe("blocked");
    expect(preview.rows[0]?.exceptions.join(" ")).toMatch(/Unmatched group/);
    expect(preview.unmatchedGroups).toHaveLength(1);
    expect(preview.unmatchedGroups[0]?.sourceName).toBe("Empower Speech");
    expect((await postImportStatement(db, statement.id, mapping)).postedCount).toBe(0);
    expect((await listGroups(db)).map((group) => group.name)).toEqual(["Acme Benefits"]);
    expect(await listCommissions(db)).toHaveLength(0);
  });

  it("does not use the agent-level default or a source split when an agreement is missing", async () => {
    const { db } = await seed();
    const statement = await savedStatement(db, [
      ["Acme Benefits", "A1", "Principal", "Dental", "Alex Morgan", "1000.00", "80.00", "75", "2026-07"],
    ]);

    const preview = await previewImportPosting(db, statement.id, mapping);
    expect(preview.rows[0]?.status).toBe("ready");
    expect(preview.rows[0]?.compensationBps).toBe(0);
    const posted = await postImportStatement(db, statement.id, mapping);
    expect(posted.postedCount).toBe(1);
    expect((await listCommissions(db))[0]?.agentCompensationCents).toBe(0);
    expect((await listCommissions(db))[0]?.agencyNetCents).toBe(8000);
    expect(await listAgreements(db)).toHaveLength(0);
  });

  it("uses the dated group compensation agreement regardless of a source split column", async () => {
    const { db, group, agent, lineOfBusiness } = await seed();
    await createAgreement(db, {
      groupId: group.id,
      agentId: agent.id,
      lineOfBusinessId: lineOfBusiness.id,
      compensationBps: 4000,
      effectiveStart: "2026-01",
    });
    const statement = await savedStatement(db, [
      ["Acme Benefits", "A1", "Principal", "Dental", "Alex Morgan", "1000.00", "80.00", "95", "2026-07"],
    ]);

    const preview = await previewImportPosting(db, statement.id, mapping);
    expect(preview.rows[0]?.status).toBe("ready");
    expect(preview.rows[0]?.compensationBps).toBe(4000);
    expect((await postImportStatement(db, statement.id, mapping)).postedCount).toBe(1);
    expect((await listCommissions(db))[0]?.agentCompensationCents).toBe(3200);
    expect((await listCommissions(db))[0]?.compensationBps).toBe(4000);
    expect(await listAgreements(db)).toHaveLength(1);
  });

  it("selects the agreement by paid month, not premium month, and leaves historical snapshots unchanged", async () => {
    const { db, group, agent, lineOfBusiness } = await seed();
    await createAgreement(db, {
      groupId: group.id,
      agentId: agent.id,
      lineOfBusinessId: lineOfBusiness.id,
      compensationBps: 4000,
      effectiveStart: "2026-01",
      effectiveEnd: "2026-06",
    });
    await createAgreement(db, {
      groupId: group.id,
      agentId: agent.id,
      lineOfBusinessId: lineOfBusiness.id,
      compensationBps: 2500,
      effectiveStart: "2026-07",
    });
    const june = await savedStatement(db, [
      ["Acme Benefits", "A1", "Principal", "Dental", "Alex Morgan", "1000.00", "80.00", "90", "2026-08"],
    ], "2026-06");
    const august = await savedStatement(db, [
      ["Acme Benefits", "A1", "Principal", "Dental", "Alex Morgan", "1000.00", "80.00", "90", "2026-05"],
    ], "2026-08");

    expect((await postImportStatement(db, june.id, mapping)).postedCount).toBe(1);
    expect((await postImportStatement(db, august.id, mapping)).postedCount).toBe(1);
    const rows = await listCommissions(db);
    const juneRow = rows.find((row) => row.importStatementId === june.id);
    const augustRow = rows.find((row) => row.importStatementId === august.id);
    expect(juneRow?.premiumMonth).toBe("2026-08");
    expect(juneRow?.compensationBps).toBe(4000);
    expect(juneRow?.agentCompensationCents).toBe(3200);
    expect(augustRow?.premiumMonth).toBe("2026-05");
    expect(augustRow?.compensationBps).toBe(2500);
    expect(augustRow?.agentCompensationCents).toBe(2000);
  });

  it("skips rows that were already posted from the same statement", async () => {
    const { db } = await seed();
    const statement = await savedStatement(db, [
      ["Acme Benefits", "A1", "Principal", "Dental", "Alex Morgan", "1000.00", "80.00", "25", "2026-07"],
    ]);

    expect((await postImportStatement(db, statement.id, mapping)).postedCount).toBe(1);
    const second = await postImportStatement(db, statement.id, mapping);
    expect(second.postedCount).toBe(0);
    expect(second.alreadyPostedCount).toBe(1);
    expect(await listCommissions(db)).toHaveLength(1);
  });

  it("uses the statement carrier when no row-level carrier column is mapped", async () => {
    const { db, carrier } = await seed();
    const statement = await savedStatement(db, [
      ["Acme Benefits", "A1", "Principal", "Dental", "Alex Morgan", "1000.00", "80.00", "25", "2026-07"],
    ], "2026-08", carrier.id);
    const withoutCarrierColumn = { ...mapping, carrier: null };

    const preview = await previewImportPosting(db, statement.id, withoutCarrierColumn);
    expect(preview.rows[0]?.status).toBe("ready");
    expect(preview.rows[0]?.carrierId).toBe(carrier.id);
    expect(preview.rows[0]?.carrierSource).toBe("statement");
    expect((await postImportStatement(db, statement.id, withoutCarrierColumn)).postedCount).toBe(1);
    expect((await listCommissions(db))[0]?.carrierId).toBe(carrier.id);
  });

  it("does not force every row to the statement carrier when a row names another carrier", async () => {
    const { db, carrier } = await seed();
    const other = await createCarrier(db, { name: "Aetna" });
    const statement = await savedStatement(db, [
      ["Acme Benefits", "A1", "Aetna", "Dental", "Alex Morgan", "1000.00", "80.00", "25", "2026-07"],
    ], "2026-08", carrier.id);

    const preview = await previewImportPosting(db, statement.id, mapping);
    expect(preview.rows[0]?.carrierId).toBe(other.id);
  });

  it("blocks unmatched row-level carriers instead of creating them", async () => {
    const { db, carrier } = await seed();
    const before = (await listCarriers(db)).length;
    const statement = await savedStatement(db, [
      ["Acme Benefits", "A1", "Unknown Mutual", "Dental", "Alex Morgan", "1000.00", "80.00", "25", "2026-07"],
    ], "2026-08", carrier.id);

    const preview = await previewImportPosting(db, statement.id, mapping);
    expect(preview.rows[0]?.status).toBe("blocked");
    expect(preview.rows[0]?.exceptions.join(" ")).toMatch(/Unmatched carrier/);
    expect((await postImportStatement(db, statement.id, mapping)).postedCount).toBe(0);
    expect(await listCarriers(db)).toHaveLength(before);
  });

  it("rejects review and posting for a saved file with no readable rows", async () => {
    const { db, carrier } = await seed();
    const statement = await createImportStatement(db, {
      originalFilename: "scan.pdf",
      paidMonth: "2026-08",
      carrierId: carrier.id,
      sourceType: "pdf",
      status: "needs_profile",
      fingerprint: fingerprintBuffer(new Uint8Array([91, 92, 93])),
      preview: { sheets: [], unmatchedGroups: [], rowCount: 0, newGroupCount: 0 },
    });

    await expect(previewImportPosting(db, statement.id, {})).rejects.toThrow(/no readable rows/i);
    await expect(postImportStatement(db, statement.id, {})).rejects.toThrow(/no readable rows/i);
    expect(await listCommissions(db)).toHaveLength(0);
  });

  it("applies an Anthem statement carrier without requiring a mapped Carrier column", async () => {
    const db = await createTestDb();
    const carrier = await createCarrier(db, { name: "Anthem" });
    await createLineOfBusiness(db, { name: "MED" });
    await createGroup(db, { name: "EXAMPLE SPEECH GROUP", groupNumber: "DEMO-POLICY-1" });
    await createGroup(db, { name: "EXAMPLE DENTAL GROUP", groupNumber: "DEMO-POLICY-2" });
    const buffer = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/anthem-08-2026.csv"));
    const preview = previewCsv(buffer, await listGroups(db));
    const statement = await createImportStatement(db, {
      originalFilename: "anthem-08-2026.csv",
      paidMonth: "2026-08",
      carrierId: carrier.id,
      sourceType: "csv",
      status: "ready_to_map",
      fingerprint: fingerprintBuffer(buffer),
      preview,
    });
    const anthemMapping = { ...suggestColumnMapping(preview.sheets[0].headers), carrier: null, agent: null };

    expect(anthemMapping.carrier).toBeNull();
    const review = await previewImportPosting(db, statement.id, anthemMapping);
    expect(review.rows.length).toBeGreaterThan(0);
    expect(review.rows.every((row) => row.carrierId === carrier.id)).toBe(true);
    expect(review.rows.every((row) => row.carrierSource === "statement")).toBe(true);
    expect(review.rows.every((row) => !row.exceptions.some((item) => /carrier/i.test(item)))).toBe(true);
    expect(review.readyCount).toBe(review.rows.length);
  });
});
