import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgreement, listAgreements } from "./agreements";
import { createAgent } from "./agents";
import { createCarrier, listCarriers } from "./carriers";
import { listCommissions } from "./commissions";
import { createGroup, listGroups } from "./groups";
import { confirmImportGroups, reviewImportGroups } from "./importGroups";
import { postImportStatement } from "./importPosting";
import { createLineOfBusiness } from "./linesOfBusiness";
import { createImportStatement, deleteImportStatement, getImportStatement, saveImportGroupResolutions } from "./statements";
import { createTestDb } from "@/db/test-db";
import { fingerprintBuffer } from "@/domain/fingerprint";
import { ValidationError } from "@/lib/errors";
import { previewWorkbook } from "@/domain/workbook";
import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import { importStatements } from "@/db/schema";

const originalDriver = process.env.STORAGE_DRIVER;
const originalImportPath = process.env.IMPORT_STORAGE_PATH;

afterEach(() => {
  if (originalDriver === undefined) delete process.env.STORAGE_DRIVER;
  else process.env.STORAGE_DRIVER = originalDriver;
  if (originalImportPath === undefined) delete process.env.IMPORT_STORAGE_PATH;
  else process.env.IMPORT_STORAGE_PATH = originalImportPath;
});

async function workbook(rows: string[][]) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Commissions");
  sheet.addRow(["Group Name", "Group Number", "Carrier", "LOB", "Agent", "Premium", "Commission", "Split", "Premium Month"]);
  for (const row of rows) sheet.addRow(row);
  return new Uint8Array(await book.xlsx.writeBuffer());
}

function localStorageDir() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "commission-statements-"));
  delete process.env.VERCEL;
  process.env.STORAGE_DRIVER = "local";
  process.env.IMPORT_STORAGE_PATH = directory;
  return directory;
}

describe("unposted statement deletion", () => {
  it("deletes an unposted statement, its original file, and its preview/resolutions without removing durable groups", async () => {
    const directory = localStorageDir();
    const db = await createTestDb();
    const carrier = await createCarrier(db, { name: "Principal" });
    await createLineOfBusiness(db, { name: "Dental" });
    await createAgent(db, { name: "Alex Morgan" });
    const buffer = await workbook([
      ["Empower Speech", "ES-9", "Principal", "Dental", "Alex Morgan", "1000.00", "80.00", "", "2026-07"],
    ]);
    const statement = await createImportStatement(db, {
      originalFilename: "principal.xlsx",
      paidMonth: "2026-08",
      carrierId: carrier.id,
      sourceType: "excel",
      status: "ready_to_map",
      fingerprint: fingerprintBuffer(buffer),
      preview: await previewWorkbook(buffer, []),
      fileBuffer: buffer,
    });
    const mapping = {
      groupName: "Group Name",
      groupNumber: "Group Number",
      carrier: "Carrier",
      lineOfBusiness: "LOB",
      agent: "Agent",
      premium: "Premium",
      grossCommission: "Commission",
      premiumMonth: "Premium Month",
    };
    const review = await reviewImportGroups(db, statement.id, mapping);
    await confirmImportGroups(db, statement.id, mapping, review.unmatchedGroups.map((group) => ({ key: group.key, action: "create" as const })));
    const saved = await getImportStatement(db, statement.id);
    expect(saved?.preview?.groupResolutions?.length).toBeGreaterThan(0);
    expect(saved?.storedPath && fs.existsSync(saved.storedPath)).toBe(true);
    const storedPath = saved!.storedPath!;
    const groupNames = (await listGroups(db)).map((group) => group.name).sort();
    expect(groupNames).toContain("Empower Speech");

    await deleteImportStatement(db, statement.id);

    expect(await getImportStatement(db, statement.id)).toBeNull();
    expect(fs.existsSync(storedPath)).toBe(false);
    expect((await listGroups(db)).map((group) => group.name).sort()).toEqual(groupNames);
    expect((await listCarriers(db)).map((item) => item.name)).toEqual(["Principal"]);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("does not delete another statement's file or record", async () => {
    const directory = localStorageDir();
    const db = await createTestDb();
    const carrier = await createCarrier(db, { name: "Principal" });
    const firstBuffer = await workbook([["Acme Benefits", "A1", "Principal", "Dental", "Alex Morgan", "1000.00", "80.00", "", "2026-07"]]);
    const secondBuffer = await workbook([["Beta Co", "B2", "Principal", "Dental", "Alex Morgan", "500.00", "40.00", "", "2026-07"]]);
    const emptyPreview = await previewWorkbook(firstBuffer, []);
    const a = await createImportStatement(db, {
      originalFilename: "a.xlsx",
      paidMonth: "2026-08",
      carrierId: carrier.id,
      sourceType: "excel",
      status: "ready_to_map",
      fingerprint: fingerprintBuffer(firstBuffer),
      preview: emptyPreview,
      fileBuffer: firstBuffer,
    });
    const b = await createImportStatement(db, {
      originalFilename: "b.xlsx",
      paidMonth: "2026-08",
      carrierId: carrier.id,
      sourceType: "excel",
      status: "ready_to_map",
      fingerprint: fingerprintBuffer(secondBuffer),
      preview: await previewWorkbook(secondBuffer, []),
      fileBuffer: secondBuffer,
    });
    const aPath = (await getImportStatement(db, a.id))!.storedPath!;
    const bPath = (await getImportStatement(db, b.id))!.storedPath!;
    expect(aPath).not.toBe(bPath);

    await deleteImportStatement(db, a.id);

    expect(await getImportStatement(db, a.id)).toBeNull();
    expect(await getImportStatement(db, b.id)).not.toBeNull();
    expect(fs.existsSync(aPath)).toBe(false);
    expect(fs.existsSync(bPath)).toBe(true);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("blocks hard deletion after commissions have been posted and leaves compensation unchanged", async () => {
    const db = await createTestDb();
    const group = await createGroup(db, { name: "Acme Benefits", groupNumber: "A1" });
    const carrier = await createCarrier(db, { name: "Principal" });
    const line = await createLineOfBusiness(db, { name: "Dental" });
    const agent = await createAgent(db, { name: "Alex Morgan" });
    await createAgreement(db, {
      groupId: group.id,
      agentId: agent.id,
      lineOfBusinessId: line.id,
      compensationBps: 4000,
      effectiveStart: "2026-01",
    });
    const buffer = await workbook([
      ["Acme Benefits", "A1", "Principal", "Dental", "Alex Morgan", "1000.00", "80.00", "", "2026-07"],
    ]);
    const statement = await createImportStatement(db, {
      originalFilename: "posted.xlsx",
      paidMonth: "2026-08",
      carrierId: carrier.id,
      sourceType: "excel",
      status: "ready_to_map",
      fingerprint: fingerprintBuffer(buffer),
      preview: await previewWorkbook(buffer, [group]),
    });
    const mapping = {
      groupName: "Group Name",
      groupNumber: "Group Number",
      carrier: "Carrier",
      lineOfBusiness: "LOB",
      agent: "Agent",
      grossCommission: "Commission",
      premiumMonth: "Premium Month",
    };
    expect((await postImportStatement(db, statement.id, mapping)).postedCount).toBe(1);
    await expect(deleteImportStatement(db, statement.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(deleteImportStatement(db, statement.id)).rejects.toThrow(/audit trail/);
    expect(await getImportStatement(db, statement.id)).not.toBeNull();
    expect(await listCommissions(db)).toHaveLength(1);
    expect((await listAgreements(db))[0]?.compensationBps).toBe(4000);

    await db.update(importStatements).set({ status: "ready_to_map", postedRowCount: 0 }).where(eq(importStatements.id, statement.id));
    await expect(deleteImportStatement(db, statement.id)).rejects.toThrow(/audit trail/);
    expect(await getImportStatement(db, statement.id)).not.toBeNull();
  });

  it("keeps the database deletion when stored file cleanup fails and reports the orphan", async () => {
    const directory = localStorageDir();
    const db = await createTestDb();
    const carrier = await createCarrier(db, { name: "Principal" });
    const buffer = await workbook([["Acme Benefits", "A1", "Principal", "Dental", "Alex Morgan", "1000.00", "80.00", "", "2026-07"]]);
    const statement = await createImportStatement(db, {
      originalFilename: "stuck.xlsx",
      paidMonth: "2026-08",
      carrierId: carrier.id,
      sourceType: "excel",
      status: "ready_to_map",
      fingerprint: fingerprintBuffer(buffer),
      preview: await previewWorkbook(buffer, []),
      fileBuffer: buffer,
    });
    const storedPath = (await getImportStatement(db, statement.id))!.storedPath!;
    fs.unlinkSync(storedPath);
    fs.mkdirSync(storedPath);

    const removed = await deleteImportStatement(db, statement.id);
    expect(removed.storageCleanupFailed).toBe(true);
    expect(removed.message).toMatch(/orphaned storage object/i);
    expect(await getImportStatement(db, statement.id)).toBeNull();
    fs.rmSync(storedPath, { recursive: true, force: true });
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("clears statement-specific saved resolutions with the deleted statement", async () => {
    const db = await createTestDb();
    const carrier = await createCarrier(db, { name: "Principal" });
    const group = await createGroup(db, { name: "Acme Benefits", groupNumber: "A1" });
    const buffer = await workbook([["Empower Speech", "ES-9", "Principal", "Dental", "Alex Morgan", "1000.00", "80.00", "", "2026-07"]]);
    const statement = await createImportStatement(db, {
      originalFilename: "resolutions.xlsx",
      paidMonth: "2026-08",
      carrierId: carrier.id,
      sourceType: "excel",
      status: "ready_to_map",
      fingerprint: fingerprintBuffer(buffer),
      preview: await previewWorkbook(buffer, []),
    });
    await saveImportGroupResolutions(db, statement.id, [{
      key: "name:empower speech|number:es-9",
      groupId: group.id,
      sourceName: "Empower Speech",
      sourceNumber: "ES-9",
      action: "match",
    }]);
    expect((await getImportStatement(db, statement.id))?.preview?.groupResolutions).toHaveLength(1);
    await deleteImportStatement(db, statement.id);
    expect(await getImportStatement(db, statement.id)).toBeNull();
    expect((await listGroups(db))[0]?.id).toBe(group.id);
  });

  it("releases the fingerprint and gives a re-upload a fresh statement without old resolutions", async () => {
    const db = await createTestDb();
    const buffer = await workbook([["Empower Speech", "ES-9", "Principal", "Dental", "", "1000.00", "80.00", "", "2026-07"]]);
    const input = {
      originalFilename: "retry.xlsx",
      paidMonth: "2026-08",
      sourceType: "excel" as const,
      status: "ready_to_map",
      fingerprint: fingerprintBuffer(buffer),
      preview: await previewWorkbook(buffer, []),
    };
    const first = await createImportStatement(db, input);
    await saveImportGroupResolutions(db, first.id, [{
      key: "name:empower speech|number:es-9",
      groupId: (await createGroup(db, { name: "Empower Speech", groupNumber: "ES-9" })).id,
      sourceName: "Empower Speech",
      sourceNumber: "ES-9",
      action: "create",
    }]);
    await deleteImportStatement(db, first.id);

    const second = await createImportStatement(db, input);
    expect(second.id).not.toBe(first.id);
    expect(second.preview?.groupResolutions).toBeUndefined();
  });
});
