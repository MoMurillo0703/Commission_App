import { and, desc, eq } from "drizzle-orm";
import { getCarrier } from "./carriers";
import { getImportStatement, saveImportColumnMapping } from "./statements";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { carrierStatementLayouts, importStatements } from "@/db/schema";
import { normalizeColumnMapping, type ColumnMapping } from "@/domain/columnMapping";
import { headerFingerprint, mappingsEqual, parseLayoutSignature, signaturesMatch, type LayoutSignature } from "@/domain/pdfLayout";
import { NotFoundError, ValidationError } from "@/lib/errors";

export type StatementLayoutView = {
  id: number;
  carrierId: number;
  name: string;
  version: number;
  status: string;
  signature: LayoutSignature;
  mapping: ColumnMapping;
};

function toView(row: typeof carrierStatementLayouts.$inferSelect): StatementLayoutView {
  return {
    id: row.id,
    carrierId: row.carrierId,
    name: row.name,
    version: row.version,
    status: row.status,
    signature: parseLayoutSignature(row.detectionSignatureJson) ?? { headerFingerprint: "", firstPageTokens: [] },
    mapping: normalizeColumnMapping(JSON.parse(row.mappingJson) as ColumnMapping),
  };
}

export async function listActiveLayoutsForCarrier(db: AppDatabase | undefined, carrierId: number) {
  const database = await resolveDb(db);
  const rows = await database
    .select()
    .from(carrierStatementLayouts)
    .where(and(eq(carrierStatementLayouts.carrierId, carrierId), eq(carrierStatementLayouts.status, "active")))
    .orderBy(desc(carrierStatementLayouts.version), desc(carrierStatementLayouts.id));
  return rows.map(toView);
}

export async function findMatchingLayout(db: AppDatabase | undefined, carrierId: number, signature: LayoutSignature) {
  const layouts = await listActiveLayoutsForCarrier(db, carrierId);
  return layouts.find((layout) => signaturesMatch(layout.signature, signature)) ?? null;
}

export async function saveCarrierStatementLayout(
  db: AppDatabase | undefined,
  input: { carrierId: number; name: string; mapping: ColumnMapping; signature: LayoutSignature },
) {
  const database = await resolveDb(db);
  if (!await getCarrier(database, input.carrierId)) throw new NotFoundError("Carrier not found.");
  const mapping = normalizeColumnMapping(input.mapping);
  if (!Object.values(mapping).some(Boolean)) {
    throw new ValidationError("Confirm the statement columns before saving this layout.");
  }
  const existing = await findMatchingLayout(database, input.carrierId, input.signature);
  if (existing && mappingsEqual(existing.mapping, mapping)) return existing;

  const now = new Date().toISOString();
  const priorVersions = await database
    .select({ version: carrierStatementLayouts.version })
    .from(carrierStatementLayouts)
    .where(and(eq(carrierStatementLayouts.carrierId, input.carrierId), eq(carrierStatementLayouts.name, input.name)))
    .orderBy(desc(carrierStatementLayouts.version));
  const version = (priorVersions[0]?.version ?? 0) + 1;
  const writeVersion = async (tx: AppDatabase) => {
    if (existing) {
      await tx.update(carrierStatementLayouts).set({
        status: "inactive",
        updatedAt: now,
      }).where(eq(carrierStatementLayouts.id, existing.id));
    }
    const [row] = await tx.insert(carrierStatementLayouts).values({
      carrierId: input.carrierId,
      name: input.name,
      version,
      status: "active",
      detectionSignatureJson: JSON.stringify(input.signature),
      mappingJson: JSON.stringify(mapping),
      createdAt: now,
      updatedAt: now,
    }).returning();
    return row;
  };
  const row = typeof database.transaction === "function"
    ? await database.transaction(async (tx) => writeVersion(tx as unknown as AppDatabase))
    : await writeVersion(database);
  return toView(row);
}

export async function attachLayoutToStatement(
  db: AppDatabase | undefined,
  statementId: number,
  layout: Pick<StatementLayoutView, "id" | "version">,
) {
  const database = await resolveDb(db);
  const [row] = await database.update(importStatements).set({
    layoutId: layout.id,
    layoutVersion: layout.version,
    updatedAt: new Date().toISOString(),
  }).where(eq(importStatements.id, statementId)).returning();
  return row;
}

export async function saveStatementLayoutFromImport(
  db: AppDatabase | undefined,
  statementId: number,
  mapping: ColumnMapping,
  name?: string,
) {
  const database = await resolveDb(db);
  const statement = await getImportStatement(database, statementId);
  if (!statement) throw new NotFoundError("Statement not found.");
  if (!statement.carrierId) throw new ValidationError("A statement carrier is required before a layout can be saved.");
  const headers = statement.preview?.sheets.flatMap((sheet) => sheet.headers) ?? [];
  const layout = await saveCarrierStatementLayout(database, {
    carrierId: statement.carrierId,
    name: name?.trim() || `${statement.carrierName ?? "Carrier"} statement layout`,
    mapping,
    signature: {
      headerFingerprint: headerFingerprint(headers),
      firstPageTokens: [],
    },
  });
  await saveImportColumnMapping(database, statementId, mapping);
  await attachLayoutToStatement(database, statementId, layout);
  return {
    statement: await getImportStatement(database, statementId),
    layout,
    message: `Saved this statement layout as “${layout.name}” version ${layout.version}. Later statements from this carrier can reuse it when they match.`,
  };
}
