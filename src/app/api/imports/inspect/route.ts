import { NextResponse } from "next/server";
import { resolveStatementCarrier } from "@/data/carriers";
import { listGroups } from "@/data/groups";
import { createImportStatement, findLatestColumnMappingForCarrier, saveImportColumnMapping } from "@/data/statements";
import { statementGuidance } from "@/domain/statementWorkflow";
import { paidMonthPattern } from "@/domain/dates";
import { fingerprintBuffer } from "@/domain/fingerprint";
import { classifyStatementFile } from "@/domain/statementFiles";
import { inspectWorkbook, previewCsv, previewWorkbook, type StatementPreview } from "@/domain/workbook";
import { getDb } from "@/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseId, toErrorResponse } from "@/lib/http";
import { emptyToNull } from "@/lib/validation";

const allowed = new Set(["application/pdf", "text/csv", "application/csv", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("statement");
  if (!(file instanceof File)) return NextResponse.json({ message: "Choose a statement file." }, { status: 400 });
  if (!allowed.has(file.type) && !/\.(csv|pdf|xls|xlsx)$/i.test(file.name)) {
    return NextResponse.json({ message: "Upload a CSV, XLSX, XLS, or PDF statement." }, { status: 415 });
  }

  const paidMonthValue = String(form.get("paidMonth") ?? "").trim();
  const persist = Boolean(paidMonthValue);
  if (persist && !paidMonthPattern.test(paidMonthValue)) {
    return NextResponse.json({ message: "Enter a paid month as YYYY-MM." }, { status: 400 });
  }

  try {
    const buffer = await file.arrayBuffer();
    const kind = classifyStatementFile(file.name, file.type);
    const isCsv = kind === "csv";
    const isPdf = kind === "pdf";
    const isLegacyXls = kind === "xls";
    if (!persist) {
      if (isPdf || isLegacyXls) {
        return NextResponse.json({
          fileName: file.name,
          fileType: isPdf ? "pdf" : "xls",
          status: isPdf ? "needs_profile" : "needs_conversion",
          message: isPdf
            ? "The app cannot read PDF rows yet. Save the statement with a paid month and carrier so you can download it and continue later."
            : "The app cannot read this older Excel (.xls) file. Save it with a paid month and carrier, then upload an XLSX or CSV version to continue.",
        });
      }
      if (isCsv) {
        const preview = previewCsv(buffer, []);
        return NextResponse.json({ fileName: file.name, fileType: "csv", status: "ready_to_map", sheets: preview.sheets, preview, message: "CSV read successfully. Confirm its carrier and column mapping." });
      }
      const sheets = await inspectWorkbook(buffer);
      return NextResponse.json({
        fileName: file.name,
        fileType: "excel",
        status: "ready_to_map",
        sheets,
        message: "Workbook inspected. Confirm the carrier and map its columns before importing.",
      });
    }

    const db = await getDb();
    const resolved = await resolveStatementCarrier(db, {
      carrierId: parseId(String(form.get("carrierId") ?? "")),
      carrierName: emptyToNull(String(form.get("carrierName") ?? "")),
    });
    const groups = await listGroups(db);
    let preview: StatementPreview;
    let sourceType: "excel" | "csv" | "xls" | "pdf";
    let status: string;
    if (isPdf || isLegacyXls) {
      preview = { sheets: [], unmatchedGroups: [], rowCount: 0, newGroupCount: 0 };
      sourceType = isPdf ? "pdf" : "xls";
      status = isPdf ? "needs_profile" : "needs_conversion";
    } else if (isCsv) {
      preview = previewCsv(buffer, groups);
      sourceType = "csv";
      status = "ready_to_map";
    } else {
      preview = await previewWorkbook(buffer, groups);
      sourceType = "excel";
      status = "ready_to_map";
    }
    let statement = await createImportStatement(db, {
      originalFilename: file.name,
      paidMonth: paidMonthValue,
      carrierId: resolved.carrier.id,
      sourceType,
      status,
      fingerprint: fingerprintBuffer(buffer),
      preview,
      fileBuffer: new Uint8Array(buffer),
    });
    const reusedMapping = status === "ready_to_map" ? await findLatestColumnMappingForCarrier(resolved.carrier.id, db) : null;
    if (reusedMapping) {
      statement = await saveImportColumnMapping(db, statement.id, reusedMapping);
    }
    const guidance = statementGuidance({
      status: statement.status,
      sourceType,
      unmatchedGroupCount: preview.newGroupCount,
      hasReadableRows: preview.rowCount > 0,
      reusedMapping: Boolean(reusedMapping),
    });

    return NextResponse.json({
      fileName: file.name,
      fileType: sourceType,
      status: statement.status,
      sheets: preview.sheets.map(({ name, rowCount, headers }) => ({ name, rowCount, headers })),
      preview,
      statement,
      carrierCreated: resolved.created,
      reusedMapping: Boolean(reusedMapping),
      message: `${guidance.title} ${guidance.next}`,
    });
  } catch (error) {
    if (error instanceof ConflictError || error instanceof ValidationError || error instanceof NotFoundError) return toErrorResponse(error);
    return NextResponse.json({ message: "The statement could not be read. Confirm that it is a valid CSV or XLSX file." }, { status: 422 });
  }
}
