import { desc, eq, sql } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { importStatements, type ImportStatement } from "@/db/schema";
import { paidMonthPattern } from "@/domain/dates";
import type { ColumnMapping } from "@/domain/columnMapping";
import type { StatementPreview } from "@/domain/workbook";
import { getCarrier } from "./carriers";
import { ConflictError, isUniqueConstraintError, NotFoundError, ValidationError } from "@/lib/errors";
import { storeStatementFile } from "@/lib/storage";

export type ImportStatementView = Omit<ImportStatement, "previewJson" | "columnMappingJson"> & {
  preview: StatementPreview | null;
  columnMapping: ColumnMapping | null;
  carrierName: string | null;
};

export type ImportStatementWrite = {
  originalFilename: string;
  displayName?: string;
  paidMonth: string;
  carrierId?: number | null;
  sourceType: "excel" | "csv" | "xls" | "pdf";
  status: string;
  fingerprint: string;
  preview: StatementPreview;
  fileBuffer?: Uint8Array;
};

function parsePreview(json: string | null): StatementPreview | null {
  if (!json) return null;
  return JSON.parse(json) as StatementPreview;
}

function parseMapping(json: string | null): ColumnMapping | null {
  if (!json) return null;
  return JSON.parse(json) as ColumnMapping;
}

function toView(row: ImportStatement, carrierName: string | null = null): ImportStatementView {
  const { previewJson, columnMappingJson, ...rest } = row;
  return {
    ...rest,
    preview: parsePreview(previewJson),
    columnMapping: parseMapping(columnMappingJson),
    carrierName,
  };
}

async function toViewWithCarrier(db: AppDatabase, row: ImportStatement, preview: StatementPreview | null | undefined = undefined): Promise<ImportStatementView> {
  const carrier = row.carrierId ? await getCarrier(db, row.carrierId) : null;
  const view = toView(row, carrier?.name ?? null);
  if (preview === null) return { ...view, preview: null };
  return view;
}

function assertPaidMonth(value: string) {
  if (!paidMonthPattern.test(value)) throw new ValidationError("Enter a paid month as YYYY-MM.");
}

export async function listImportStatements(paidMonth: string, db?: AppDatabase) {
  assertPaidMonth(paidMonth);
  const database = await resolveDb(db);
  const rows = await database
    .select()
    .from(importStatements)
    .where(eq(importStatements.paidMonth, paidMonth))
    .orderBy(desc(importStatements.uploadedAt), desc(importStatements.id));
  return Promise.all(rows.map((row) => toViewWithCarrier(database, row, null)));
}

export async function findLatestColumnMappingForCarrier(carrierId: number, db?: AppDatabase) {
  const database = await resolveDb(db);
  const rows = await database
    .select()
    .from(importStatements)
    .where(eq(importStatements.carrierId, carrierId))
    .orderBy(desc(importStatements.updatedAt), desc(importStatements.id));
  for (const row of rows) {
    const mapping = parseMapping(row.columnMappingJson);
    if (mapping && Object.values(mapping).some(Boolean)) return mapping;
  }
  return null;
}

export async function listImportPaidMonths(db?: AppDatabase) {
  const database = await resolveDb(db);
  const rows = await database
    .selectDistinct({ paidMonth: importStatements.paidMonth })
    .from(importStatements)
    .orderBy(desc(sql`${importStatements.paidMonth}`));
  return rows.map((row) => row.paidMonth);
}

export async function getImportStatement(db: AppDatabase | undefined, id: number) {
  const database = await resolveDb(db);
  const [row] = await database.select().from(importStatements).where(eq(importStatements.id, id)).limit(1);
  return row ? toViewWithCarrier(database, row) : null;
}

export async function findImportStatementByFingerprint(db: AppDatabase, fingerprint: string) {
  const [row] = await db.select().from(importStatements).where(eq(importStatements.fingerprint, fingerprint)).limit(1);
  return row ? toViewWithCarrier(db, row) : null;
}

export async function createImportStatement(db: AppDatabase | undefined, input: ImportStatementWrite): Promise<ImportStatementView> {
  const database = await resolveDb(db);
  assertPaidMonth(input.paidMonth);
  if (input.carrierId != null && !await getCarrier(database, input.carrierId)) {
    throw new NotFoundError("Carrier not found.");
  }
  const existing = await findImportStatementByFingerprint(database, input.fingerprint);
  if (existing) {
    throw new ConflictError(
      `This file was already uploaded as "${existing.displayName}" for ${existing.paidMonth}.`,
      existing,
    );
  }

  const now = new Date().toISOString();
  const displayName = input.displayName?.trim() || input.originalFilename;
  try {
    const [inserted] = await database.insert(importStatements).values({
      originalFilename: input.originalFilename,
      displayName,
      paidMonth: input.paidMonth,
      uploadedAt: now,
      sourceType: input.sourceType,
      status: input.status,
      fingerprint: input.fingerprint,
      rowCount: input.preview.rowCount,
      newGroupCount: input.preview.newGroupCount,
      previewJson: JSON.stringify(input.preview),
      storedPath: null,
      columnMappingJson: null,
      postedRowCount: 0,
      carrierId: input.carrierId ?? null,
      createdAt: now,
      updatedAt: now,
    }).returning();

    if (input.fileBuffer) {
      let storedPath: string;
      try {
        storedPath = await storeStatementFile(inserted.id, input.originalFilename, input.fileBuffer);
      } catch (error) {
        await database.delete(importStatements).where(eq(importStatements.id, inserted.id));
        throw error;
      }
      const [updated] = await database.update(importStatements).set({ storedPath, updatedAt: now }).where(eq(importStatements.id, inserted.id)).returning();
      return toViewWithCarrier(database, updated);
    }

    return toViewWithCarrier(database, inserted);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const duplicate = await findImportStatementByFingerprint(database, input.fingerprint);
      throw new ConflictError(
        duplicate
          ? `This file was already uploaded as "${duplicate.displayName}" for ${duplicate.paidMonth}.`
          : "This file was already uploaded.",
        duplicate,
      );
    }
    throw error;
  }
}

export async function saveImportColumnMapping(db: AppDatabase | undefined, id: number, columnMapping: ColumnMapping) {
  const database = await resolveDb(db);
  const existing = await getImportStatement(database, id);
  if (!existing) throw new NotFoundError("Statement not found.");
  const [row] = await database.update(importStatements).set({
    columnMappingJson: JSON.stringify(columnMapping),
    status: existing.status === "ready_to_map" ? "mapped" : existing.status,
    updatedAt: new Date().toISOString(),
  }).where(eq(importStatements.id, id)).returning();
  return toViewWithCarrier(database, row);
}

export async function markImportStatementPosted(db: AppDatabase | undefined, id: number, postedRowCount: number, status: string) {
  const database = await resolveDb(db);
  if (!await getImportStatement(database, id)) throw new NotFoundError("Statement not found.");
  const [row] = await database.update(importStatements).set({
    postedRowCount,
    status,
    updatedAt: new Date().toISOString(),
  }).where(eq(importStatements.id, id)).returning();
  return toViewWithCarrier(database, row);
}

export async function renameImportStatement(db: AppDatabase | undefined, id: number, displayName: string) {
  const database = await resolveDb(db);
  if (!await getImportStatement(database, id)) throw new NotFoundError("Statement not found.");
  const name = displayName.trim();
  if (!name) throw new ValidationError("Display name is required.");
  const [row] = await database.update(importStatements).set({ displayName: name, updatedAt: new Date().toISOString() }).where(eq(importStatements.id, id)).returning();
  return toViewWithCarrier(database, row);
}
