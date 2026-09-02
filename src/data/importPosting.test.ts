import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { createAgreement } from "./agreements";
import { createAgent } from "./agents";
import { createCarrier, listCarriers } from "./carriers";
import { listCommissions } from "./commissions";
import { createGroup, listGroups } from "./groups";
import { postImportStatement, previewImportPosting } from "./importPosting";
import { createLineOfBusiness } from "./linesOfBusiness";
import { createImportStatement } from "./statements";
import { createTestDb } from "@/db/test-db";
import type { ColumnMapping } from "@/domain/columnMapping";
import { fingerprintBuffer } from "@/domain/fingerprint";
import { previewWorkbook } from "@/domain/workbook";

const mapping: ColumnMapping = {
  groupName: "Group Name",
  groupNumber: "Group Number",
  carrier: "Carrier",
  lineOfBusiness: "LOB",
  agent: "Agent",
  premium: "Premium",
  grossCommission: "Commission",
  compensationPercent: "Split",
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
  it("posts ready rows using the statement paid month and keeps coverage month separate", async () => {
    const { db } = await seed();
    const statement = await savedStatement(db, [
      ["Acme Benefits", "A1", "Principal", "Dental", "Alex Morgan", "10000.00", "500.00", "40", "2026-07"],
    ]);

    const posted = await postImportStatement(db, statement.id, mapping);
    const [row] = await listCommissions(db);

    expect(posted.postedCount).toBe(1);
    expect(row.statementMonth).toBe("2026-08");
    expect(row.premiumMonth).toBe("2026-07");
    expect(row.grossCommissionCents).toBe(50000);
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
    expect((await postImportStatement(db, statement.id, mapping)).postedCount).toBe(0);
    expect((await listGroups(db)).map((group) => group.name)).toEqual(["Acme Benefits"]);
    expect(await listCommissions(db)).toHaveLength(0);
  });

  it("does not use the agent-level default when a split and agreement are missing", async () => {
    const { db } = await seed();
    const statement = await savedStatement(db, [
      ["Acme Benefits", "A1", "Principal", "Dental", "Alex Morgan", "1000.00", "80.00", "", "2026-07"],
    ]);

    const preview = await previewImportPosting(db, statement.id, mapping);
    expect(preview.rows[0]?.status).toBe("ready");
    expect(preview.rows[0]?.compensationBps).toBe(0);
    const posted = await postImportStatement(db, statement.id, mapping);
    expect(posted.postedCount).toBe(1);
    expect((await listCommissions(db))[0]?.agentCompensationCents).toBe(0);
    expect((await listCommissions(db))[0]?.agencyNetCents).toBe(8000);
  });

  it("uses the dated group compensation agreement when the import split is blank", async () => {
    const { db, group, agent, lineOfBusiness } = await seed();
    await createAgreement(db, {
      groupId: group.id,
      agentId: agent.id,
      lineOfBusinessId: lineOfBusiness.id,
      compensationBps: 4000,
      effectiveStart: "2026-01",
    });
    const statement = await savedStatement(db, [
      ["Acme Benefits", "A1", "Principal", "Dental", "Alex Morgan", "1000.00", "80.00", "", "2026-07"],
    ]);

    const preview = await previewImportPosting(db, statement.id, mapping);
    expect(preview.rows[0]?.status).toBe("ready");
    expect(preview.rows[0]?.compensationBps).toBe(4000);
    expect((await postImportStatement(db, statement.id, mapping)).postedCount).toBe(1);
    expect((await listCommissions(db))[0]?.agentCompensationCents).toBe(3200);
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
});
