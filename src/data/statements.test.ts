import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { createCarrier, listCarriers, resolveStatementCarrier } from "./carriers";
import { createGroup } from "./groups";
import {
  createImportStatement,
  findLatestColumnMappingForCarrier,
  getImportStatement,
  listImportPaidMonths,
  listImportStatements,
  renameImportStatement,
  saveImportColumnMapping,
} from "./statements";
import { createTestDb } from "@/db/test-db";
import { fingerprintBuffer } from "@/domain/fingerprint";
import { previewWorkbook } from "@/domain/workbook";
import { ConflictError } from "@/lib/errors";

async function workbookBuffer(rows: Array<Record<string, string>>) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Commissions");
  sheet.addRow(["Group Name", "Group Number", "Premium Month", "Commission"]);
  for (const row of rows) {
    sheet.addRow([row.groupName, row.groupNumber, row.premiumMonth, row.commission]);
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

describe("import statement intake", () => {
  it("stores a statement under the selected paid month and keeps premium month on the preview row", async () => {
    const db = await createTestDb();
    await createGroup(db, { name: "Acme Benefits", groupNumber: "A1" });
    const buffer = await workbookBuffer([
      { groupName: "Acme Benefits", groupNumber: "A1", premiumMonth: "2026-07", commission: "500.00" },
      { groupName: "Empower Speech", groupNumber: "ES-9", premiumMonth: "2026-07", commission: "120.00" },
    ]);
    const preview = await previewWorkbook(buffer, [{ id: 1, name: "Acme Benefits", groupNumber: "A1" }]);

    const statement = await createImportStatement(db, {
      originalFilename: "principal-july.xlsx",
      paidMonth: "2026-08",
      sourceType: "excel",
      status: "ready_to_map",
      fingerprint: fingerprintBuffer(buffer),
      preview,
    });

    expect(statement.paidMonth).toBe("2026-08");
    expect(statement.originalFilename).toBe("principal-july.xlsx");
    expect(statement.displayName).toBe("principal-july.xlsx");
    expect(statement.sourceType).toBe("excel");
    expect(statement.status).toBe("ready_to_map");
    expect(statement.uploadedAt).toEqual(expect.any(String));
    expect(statement.preview?.rowCount).toBe(2);
    expect(statement.preview?.newGroupCount).toBe(1);
    expect(statement.preview?.sheets[0]?.rows[0]?.premiumMonth).toBe("2026-07");
    expect(statement.preview?.unmatchedGroups).toEqual([
      { sourceName: "Empower Speech", sourceNumber: "ES-9", rowCount: 1 },
    ]);
    expect(await listImportStatements("2026-08", db)).toHaveLength(1);
    expect(await listImportStatements("2026-07", db)).toHaveLength(0);
  });

  it("renames the display name without changing the original filename", async () => {
    const db = await createTestDb();
    const buffer = await workbookBuffer([{ groupName: "Acme", groupNumber: "A1", premiumMonth: "2026-07", commission: "10" }]);
    const created = await createImportStatement(db, {
      originalFilename: "carrier.xlsx",
      paidMonth: "2026-09",
      sourceType: "excel",
      status: "ready_to_map",
      fingerprint: fingerprintBuffer(buffer),
      preview: await previewWorkbook(buffer, []),
    });

    const renamed = await renameImportStatement(db, created.id, "September Principal medical");
    expect(renamed.displayName).toBe("September Principal medical");
    expect(renamed.originalFilename).toBe("carrier.xlsx");
  });

  it("rejects an exact duplicate file by fingerprint", async () => {
    const db = await createTestDb();
    const buffer = await workbookBuffer([{ groupName: "Acme", groupNumber: "A1", premiumMonth: "2026-07", commission: "10" }]);
    const input = {
      originalFilename: "carrier.xlsx",
      paidMonth: "2026-09" as const,
      sourceType: "excel" as const,
      status: "ready_to_map",
      fingerprint: fingerprintBuffer(buffer),
      preview: await previewWorkbook(buffer, []),
    };
    await createImportStatement(db, input);
    await expect(createImportStatement(db, { ...input, paidMonth: "2026-10" })).rejects.toThrow(ConflictError);
  });

  it("stores an existing carrier on the statement", async () => {
    const db = await createTestDb();
    const carrier = await createCarrier(db, { name: "Principal" });
    const buffer = await workbookBuffer([{ groupName: "Acme", groupNumber: "A1", premiumMonth: "2026-07", commission: "10" }]);
    const resolved = await resolveStatementCarrier(db, { carrierId: carrier.id });
    const statement = await createImportStatement(db, {
      originalFilename: "principal.xlsx",
      paidMonth: "2026-08",
      carrierId: resolved.carrier.id,
      sourceType: "excel",
      status: "ready_to_map",
      fingerprint: fingerprintBuffer(buffer),
      preview: await previewWorkbook(buffer, []),
    });

    expect(resolved.created).toBe(false);
    expect(statement.carrierId).toBe(carrier.id);
    expect(statement.carrierName).toBe("Principal");
    expect((await listImportStatements("2026-08", db))[0]?.carrierName).toBe("Principal");
  });

  it("creates a new carrier during intake and persists its stable id", async () => {
    const db = await createTestDb();
    const buffer = await workbookBuffer([{ groupName: "Acme", groupNumber: "A1", premiumMonth: "2026-07", commission: "10" }]);
    const resolved = await resolveStatementCarrier(db, { carrierName: "UnitedHealthcare" });
    const statement = await createImportStatement(db, {
      originalFilename: "uhc.xlsx",
      paidMonth: "2026-08",
      carrierId: resolved.carrier.id,
      sourceType: "excel",
      status: "ready_to_map",
      fingerprint: fingerprintBuffer(buffer),
      preview: await previewWorkbook(buffer, []),
    });

    expect(resolved.created).toBe(true);
    expect(statement.carrierId).toBe(resolved.carrier.id);
    expect((await getImportStatement(db, statement.id))?.carrierName).toBe("UnitedHealthcare");
    expect((await listCarriers(db)).map((row) => row.name)).toEqual(["UnitedHealthcare"]);
  });

  it("reuses a normalized existing carrier instead of creating a duplicate", async () => {
    const db = await createTestDb();
    const carrier = await createCarrier(db, { name: "Principal" });
    const resolved = await resolveStatementCarrier(db, { carrierName: " principal " });
    expect(resolved.created).toBe(false);
    expect(resolved.carrier.id).toBe(carrier.id);
    expect(await listCarriers(db)).toHaveLength(1);
  });

  it("keeps a legacy statement without a carrier readable", async () => {
    const db = await createTestDb();
    const buffer = await workbookBuffer([{ groupName: "Acme", groupNumber: "A1", premiumMonth: "2026-07", commission: "10" }]);
    const statement = await createImportStatement(db, {
      originalFilename: "legacy.xlsx",
      paidMonth: "2026-08",
      sourceType: "excel",
      status: "ready_to_map",
      fingerprint: fingerprintBuffer(buffer),
      preview: await previewWorkbook(buffer, []),
    });

    expect(statement.carrierId).toBeNull();
    expect(statement.carrierName).toBeNull();
    expect((await getImportStatement(db, statement.id))?.displayName).toBe("legacy.xlsx");
    expect((await listImportStatements("2026-08", db))[0]?.carrierName).toBeNull();
  });

  it("lists statements by paid month so an upload remains findable", async () => {
    const db = await createTestDb();
    const first = await workbookBuffer([{ groupName: "Acme", groupNumber: "A1", premiumMonth: "2026-07", commission: "10" }]);
    const second = await workbookBuffer([{ groupName: "Beta", groupNumber: "B2", premiumMonth: "2026-07", commission: "12" }]);
    await createImportStatement(db, {
      originalFilename: "august.csv",
      paidMonth: "2026-08",
      sourceType: "csv",
      status: "ready_to_map",
      fingerprint: fingerprintBuffer(first),
      preview: await previewWorkbook(first, []),
    });
    await createImportStatement(db, {
      originalFilename: "july.xlsx",
      paidMonth: "2026-07",
      sourceType: "excel",
      status: "ready_to_map",
      fingerprint: fingerprintBuffer(second),
      preview: await previewWorkbook(second, []),
    });
    expect(await listImportPaidMonths(db)).toEqual(["2026-08", "2026-07"]);
    expect((await listImportStatements("2026-08", db)).map((row) => row.originalFilename)).toEqual(["august.csv"]);
  });

  it("reuses a saved carrier column layout and keeps an unfinished statement resumable", async () => {
    const db = await createTestDb();
    const carrier = await createCarrier(db, { name: "Anthem" });
    const first = await workbookBuffer([{ groupName: "Acme", groupNumber: "A1", premiumMonth: "2026-07", commission: "10" }]);
    const second = await workbookBuffer([{ groupName: "Beta", groupNumber: "B2", premiumMonth: "2026-07", commission: "20" }]);
    const original = await createImportStatement(db, {
      originalFilename: "anthem-1.csv",
      paidMonth: "2026-08",
      carrierId: carrier.id,
      sourceType: "csv",
      status: "ready_to_map",
      fingerprint: fingerprintBuffer(first),
      preview: await previewWorkbook(first, []),
    });
    await saveImportColumnMapping(db, original.id, { groupName: "Group Name", grossCommission: "Commission" });
    expect(await findLatestColumnMappingForCarrier(carrier.id, db)).toEqual({
      groupName: "Group Name",
      grossCommission: "Commission",
    });
    const unfinished = await getImportStatement(db, original.id);
    expect(unfinished?.status).toBe("mapped");
    expect(unfinished?.columnMapping?.groupName).toBe("Group Name");
    const later = await createImportStatement(db, {
      originalFilename: "anthem-2.csv",
      paidMonth: "2026-08",
      carrierId: carrier.id,
      sourceType: "csv",
      status: "ready_to_map",
      fingerprint: fingerprintBuffer(second),
      preview: await previewWorkbook(second, []),
    });
    expect(later.status).toBe("ready_to_map");
    expect(await findLatestColumnMappingForCarrier(carrier.id, db)).toMatchObject({ grossCommission: "Commission" });
  });

  it("saves PDF and XLS originals as resumable statements without pretending they were parsed", async () => {
    const db = await createTestDb();
    const carrier = await createCarrier(db, { name: "Principal" });
    const emptyPreview = { sheets: [], unmatchedGroups: [], rowCount: 0, newGroupCount: 0 };
    const pdf = await createImportStatement(db, {
      originalFilename: "scan.pdf",
      paidMonth: "2026-08",
      carrierId: carrier.id,
      sourceType: "pdf",
      status: "needs_profile",
      fingerprint: fingerprintBuffer(new Uint8Array([1, 2, 3])),
      preview: emptyPreview,
    });
    const xls = await createImportStatement(db, {
      originalFilename: "legacy.xls",
      paidMonth: "2026-08",
      carrierId: carrier.id,
      sourceType: "xls",
      status: "needs_conversion",
      fingerprint: fingerprintBuffer(new Uint8Array([4, 5, 6])),
      preview: emptyPreview,
    });
    expect((await listImportStatements("2026-08", db)).map((row) => row.originalFilename)).toEqual(["legacy.xls", "scan.pdf"]);
    expect(pdf.status).toBe("needs_profile");
    expect(xls.status).toBe("needs_conversion");
    expect(pdf.preview?.rowCount).toBe(0);
  });
});
