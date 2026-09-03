import { NextResponse } from "next/server";
import { resolveStatementCarrier } from "@/data/carriers";
import { listGroups } from "@/data/groups";
import { previewPdfStatement } from "@/data/pdfStatements";
import { attachLayoutToStatement, findMatchingLayout } from "@/data/statementLayouts";
import { createImportStatement, findLatestColumnMappingForCarrier, saveImportColumnMapping, saveImportExtractionPath, saveImportPreview } from "@/data/statements";
import { buildLayoutSignature } from "@/domain/pdfLayout";
import { statementGuidance } from "@/domain/statementWorkflow";
import { paidMonthPattern } from "@/domain/dates";
import { fingerprintBuffer } from "@/domain/fingerprint";
import { classifyStatementFile } from "@/domain/statementFiles";
import { inspectWorkbook, previewCsv, previewWorkbook, type StatementPreview } from "@/domain/workbook";
import { getDb } from "@/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseId, toErrorResponse } from "@/lib/http";
import { storeStatementFile } from "@/lib/storage";
import { emptyToNull } from "@/lib/validation";

const allowed = new Set(["application/pdf", "text/csv", "application/csv", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);
const maxStatementBytes = 20 * 1024 * 1024;

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("statement");
  if (!(file instanceof File)) return NextResponse.json({ message: "Choose a statement file." }, { status: 400 });
  if (!allowed.has(file.type) && !/\.(csv|pdf|xls|xlsx)$/i.test(file.name)) {
    return NextResponse.json({ message: "Upload a CSV, XLSX, XLS, or PDF statement." }, { status: 415 });
  }
  if (file.size > maxStatementBytes) {
    return NextResponse.json({ message: "Statement files must be 20 MB or smaller." }, { status: 413 });
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
      if (isPdf) {
        const { extraction, preview } = await previewPdfStatement(buffer, []);
        const status = extraction.classification === "readable"
          ? (preview.rowCount > 0 ? "ready_to_map" : "needs_layout")
          : extraction.classification === "failed" ? "extraction_failed" : "unreadable";
        const guidance = statementGuidance({
          status,
          sourceType: "pdf",
          hasReadableRows: preview.rowCount > 0,
          pdfClassification: preview.pdf?.classification,
        });
        return NextResponse.json({
          fileName: file.name,
          fileType: "pdf",
          status,
          sheets: preview.sheets.map(({ name, rowCount, headers }) => ({ name, rowCount, headers })),
          preview,
          message: `${guidance.title} ${guidance.next}`,
        });
      }
      if (isLegacyXls) {
        return NextResponse.json({
          fileName: file.name,
          fileType: "xls",
          status: "needs_conversion",
          message: "The app cannot read this older Excel (.xls) file. Save it with a paid month and carrier, then upload an XLSX or CSV version to continue.",
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
    let pdfExtraction: Awaited<ReturnType<typeof previewPdfStatement>>["extraction"] | null = null;
    if (isPdf) {
      const extracted = await previewPdfStatement(buffer, groups);
      preview = extracted.preview;
      pdfExtraction = extracted.extraction;
      sourceType = "pdf";
      status = extracted.extraction.classification === "readable"
        ? (preview.rowCount > 0 ? "ready_to_map" : "needs_layout")
        : extracted.extraction.classification === "failed" ? "extraction_failed" : "unreadable";
    } else if (isLegacyXls) {
      preview = { sheets: [], unmatchedGroups: [], rowCount: 0, newGroupCount: 0 };
      sourceType = "xls";
      status = "needs_conversion";
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
    let reusedMapping = false;
    if (isPdf && preview.rowCount > 0) {
      const signature = buildLayoutSignature(
        preview.sheets.flatMap((sheet) => sheet.headers),
        pdfExtraction?.pages[0]?.text ?? "",
      );
      const layout = await findMatchingLayout(db, resolved.carrier.id, signature);
      if (layout) {
        statement = await saveImportColumnMapping(db, statement.id, layout.mapping);
        await attachLayoutToStatement(db, statement.id, layout);
        preview = {
          ...preview,
          pdf: {
            ...preview.pdf,
            classification: preview.pdf?.classification ?? "readable",
            pageCount: preview.pdf?.pageCount ?? pdfExtraction?.pages.length ?? 0,
            layoutId: layout.id,
            layoutVersion: layout.version,
            layoutName: layout.name,
          },
        };
        reusedMapping = true;
        statement = await saveImportPreview(db, statement.id, preview);
      }
    } else if (status === "ready_to_map") {
      const prior = await findLatestColumnMappingForCarrier(resolved.carrier.id, db);
      if (prior) {
        statement = await saveImportColumnMapping(db, statement.id, prior);
        reusedMapping = true;
      }
    }
    if (pdfExtraction && (pdfExtraction.pages.length > 0 || pdfExtraction.classification === "failed")) {
      const artifact = new TextEncoder().encode(JSON.stringify({
        classification: pdfExtraction.classification,
        pageCount: pdfExtraction.pages.length,
        pages: pdfExtraction.pages.map((page) => ({
          pageNumber: page.pageNumber,
          characterCount: page.text.length,
          lines: page.lines,
        })),
      }));
      const extractionPath = await storeStatementFile(statement.id, "extraction.json", artifact);
      statement = await saveImportExtractionPath(db, statement.id, extractionPath);
    }
    const guidance = statementGuidance({
      status: statement.status,
      sourceType,
      unmatchedGroupCount: preview.newGroupCount,
      hasReadableRows: preview.rowCount > 0,
      reusedMapping,
      pdfClassification: preview.pdf?.classification,
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
