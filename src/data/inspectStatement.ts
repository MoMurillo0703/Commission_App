import { resolveStatementCarrier } from "@/data/carriers";
import { listGroups } from "@/data/groups";
import { previewPdfStatement } from "@/data/pdfStatements";
import { attachLayoutToStatement, findMatchingLayout } from "@/data/statementLayouts";
import { createImportStatement, findLatestColumnMappingForCarrier, saveImportColumnMapping, saveImportExtractionPath, saveImportPreview } from "@/data/statements";
import { buildLayoutSignature } from "@/domain/pdfLayout";
import { statementGuidance } from "@/domain/statementWorkflow";
import { paidMonthPattern } from "@/domain/dates";
import { fingerprintBuffer } from "@/domain/fingerprint";
import {
  fileExtension,
  inspectFailureMessage,
  statementInspectLog,
} from "@/domain/statementInspect";
import { classifyStatementFile, hasPdfMagic, type StatementFileKind } from "@/domain/statementFiles";
import { inspectWorkbook, previewCsv, previewWorkbook, type StatementPreview } from "@/domain/workbook";
import type { AppDatabase } from "@/db";
import { parseId } from "@/lib/http";
import { storeStatementFile } from "@/lib/storage";
import { emptyToNull } from "@/lib/validation";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";

const allowed = new Set(["application/pdf", "text/csv", "application/csv", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);
const maxStatementBytes = 20 * 1024 * 1024;

export type InspectStatementInput = {
  fileName: string;
  mimeType: string;
  size: number;
  buffer: ArrayBuffer | Uint8Array;
  paidMonth?: string | null;
  carrierId?: string | null;
  carrierName?: string | null;
  persist?: boolean;
};

export type InspectStatementResult = {
  status: number;
  body: Record<string, unknown>;
};

export function inspectUploadGuards(input: Pick<InspectStatementInput, "fileName" | "mimeType" | "size" | "paidMonth" | "persist"> & { buffer?: ArrayBuffer | Uint8Array }) {
  if (!allowed.has(input.mimeType) && !/\.(csv|pdf|xls|xlsx)$/i.test(input.fileName) && !hasPdfMagic(input.buffer)) {
    return { status: 415, body: { message: "Upload a CSV, XLSX, XLS, or PDF statement." } };
  }
  if (input.size > maxStatementBytes) {
    return { status: 413, body: { message: "Statement files must be 20 MB or smaller." } };
  }
  const paidMonthValue = String(input.paidMonth ?? "").trim();
  const persist = Boolean(input.persist ?? paidMonthValue);
  if (persist && !paidMonthPattern.test(paidMonthValue)) {
    return { status: 400, body: { message: "Enter a paid month as YYYY-MM." } };
  }
  return null;
}

async function inspectPdfPreview(buffer: ArrayBuffer | Uint8Array, groups: Awaited<ReturnType<typeof listGroups>>) {
  try {
    return await previewPdfStatement(buffer, groups);
  } catch (error) {
    statementInspectLog({
      outcome: "pdf_extraction_exception",
      classifiedAs: "pdf",
      mimeType: "application/pdf",
      extension: ".pdf",
      byteLength: buffer.byteLength,
      persist: false,
      failureType: "extraction_exception",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return {
      extraction: {
        classification: "failed" as const,
        pages: [],
        characterCount: 0,
        message: "PDF extraction failed — original retained.",
      },
      preview: {
        sheets: [],
        unmatchedGroups: [],
        rowCount: 0,
        newGroupCount: 0,
        pdf: { classification: "failed" as const, pageCount: 0 },
      } satisfies StatementPreview,
    };
  }
}

export async function inspectStatementUpload(
  input: InspectStatementInput,
  db?: AppDatabase,
): Promise<InspectStatementResult> {
  const paidMonthValue = String(input.paidMonth ?? "").trim();
  const persist = Boolean(input.persist ?? paidMonthValue);
  const guard = inspectUploadGuards({ ...input, persist, paidMonth: paidMonthValue, buffer: input.buffer });
  if (guard) return guard;

  const bytes = input.buffer instanceof Uint8Array
    ? Uint8Array.from(input.buffer)
    : new Uint8Array(input.buffer);
  const byteLength = bytes.byteLength;
  const kind = classifyStatementFile(input.fileName, input.mimeType, bytes);
  const extension = fileExtension(input.fileName);
  statementInspectLog({
    outcome: "classified",
    classifiedAs: kind,
    mimeType: input.mimeType,
    extension,
    byteLength,
    persist,
  });

  try {
    const isCsv = kind === "csv";
    const isPdf = kind === "pdf";
    const isLegacyXls = kind === "xls";

    if (!persist) {
      if (isPdf) {
        const { extraction, preview } = await inspectPdfPreview(bytes, []);
        const status = extraction.classification === "readable"
          ? (preview.rowCount > 0 ? "ready_to_map" : "needs_layout")
          : extraction.classification === "failed" ? "extraction_failed" : "unreadable";
        const guidance = statementGuidance({
          status,
          sourceType: "pdf",
          hasReadableRows: preview.rowCount > 0,
          pdfClassification: preview.pdf?.classification,
        });
        statementInspectLog({
          outcome: status,
          classifiedAs: "pdf",
          mimeType: input.mimeType,
          extension,
          byteLength,
          persist,
          failureType: status === "ready_to_map" || status === "needs_layout" ? undefined : status,
        });
        return {
          status: 200,
          body: {
            fileName: input.fileName,
            fileType: "pdf",
            status,
            sheets: preview.sheets.map(({ name, rowCount, headers }) => ({ name, rowCount, headers })),
            preview,
            message: `${guidance.title} ${guidance.next}`,
          },
        };
      }
      if (isLegacyXls) {
        return {
          status: 200,
          body: {
            fileName: input.fileName,
            fileType: "xls",
            status: "needs_conversion",
            message: "The app cannot read this older Excel (.xls) file. Save it with a paid month and carrier, then upload an XLSX or CSV version to continue.",
          },
        };
      }
      if (isCsv) {
        const preview = previewCsv(bytes, []);
        return {
          status: 200,
          body: {
            fileName: input.fileName,
            fileType: "csv",
            status: "ready_to_map",
            sheets: preview.sheets,
            preview,
            message: "CSV read successfully. Confirm its carrier and column mapping.",
          },
        };
      }
      if (kind !== "excel") {
        return { status: 415, body: { message: "Upload a CSV, XLSX, XLS, or PDF statement." } };
      }
      const sheets = await inspectWorkbook(bytes);
      return {
        status: 200,
        body: {
          fileName: input.fileName,
          fileType: "excel",
          status: "ready_to_map",
          sheets,
          message: "Workbook inspected. Confirm the carrier and map its columns before importing.",
        },
      };
    }

    if (!db) throw new ValidationError("A database is required to save a statement.");
    const resolved = await resolveStatementCarrier(db, {
      carrierId: parseId(String(input.carrierId ?? "")),
      carrierName: emptyToNull(String(input.carrierName ?? "")),
    });
    const groups = await listGroups(db);
    let preview: StatementPreview;
    let sourceType: StatementFileKind;
    let status: string;
    let pdfExtraction: Awaited<ReturnType<typeof previewPdfStatement>>["extraction"] | null = null;
    let inferredPdfMapping = null as Awaited<ReturnType<typeof inspectPdfPreview>>["mapping"];
    if (isPdf) {
      const extracted = await inspectPdfPreview(bytes, groups);
      preview = extracted.preview;
      pdfExtraction = extracted.extraction;
      inferredPdfMapping = extracted.mapping;
      sourceType = "pdf";
      status = extracted.extraction.classification === "readable"
        ? (preview.rowCount > 0 ? "ready_to_map" : "needs_layout")
        : extracted.extraction.classification === "failed" ? "extraction_failed" : "unreadable";
    } else if (isLegacyXls) {
      preview = { sheets: [], unmatchedGroups: [], rowCount: 0, newGroupCount: 0 };
      sourceType = "xls";
      status = "needs_conversion";
    } else if (isCsv) {
      preview = previewCsv(bytes, groups);
      sourceType = "csv";
      status = "ready_to_map";
    } else if (kind === "excel") {
      preview = await previewWorkbook(bytes, groups);
      sourceType = "excel";
      status = "ready_to_map";
    } else {
      return { status: 415, body: { message: "Upload a CSV, XLSX, XLS, or PDF statement." } };
    }

    let statement = await createImportStatement(db, {
      originalFilename: input.fileName,
      paidMonth: paidMonthValue,
      carrierId: resolved.carrier.id,
      sourceType,
      status,
      fingerprint: fingerprintBuffer(bytes),
      preview,
      fileBuffer: bytes,
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
      } else if (inferredPdfMapping) {
        statement = await saveImportColumnMapping(db, statement.id, inferredPdfMapping);
      }
    } else if (status === "ready_to_map") {
      const prior = await findLatestColumnMappingForCarrier(resolved.carrier.id, db);
      if (prior) {
        statement = await saveImportColumnMapping(db, statement.id, prior);
        reusedMapping = true;
      }
    }
    if (pdfExtraction && (pdfExtraction.pages.length > 0 || pdfExtraction.classification === "failed")) {
      try {
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
      } catch (error) {
        statementInspectLog({
          outcome: "extraction_artifact_failed",
          classifiedAs: "pdf",
          mimeType: input.mimeType,
          extension,
          byteLength,
          persist,
          failureType: "artifact_store",
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }
    const guidance = statementGuidance({
      status: statement.status,
      sourceType,
      unmatchedGroupCount: preview.newGroupCount,
      hasReadableRows: preview.rowCount > 0,
      reusedMapping,
      pdfClassification: preview.pdf?.classification,
    });
    statementInspectLog({
      outcome: statement.status,
      classifiedAs: sourceType,
      mimeType: input.mimeType,
      extension,
      byteLength,
      persist,
    });
    return {
      status: 200,
      body: {
        fileName: input.fileName,
        fileType: sourceType,
        status: statement.status,
        sheets: preview.sheets.map(({ name, rowCount, headers }) => ({ name, rowCount, headers })),
        preview,
        statement,
        carrierCreated: resolved.created,
        reusedMapping: Boolean(reusedMapping),
        message: `${guidance.title} ${guidance.next}`,
      },
    };
  } catch (error) {
    if (error instanceof ConflictError || error instanceof ValidationError || error instanceof NotFoundError) throw error;
    statementInspectLog({
      outcome: "inspect_failed",
      classifiedAs: kind,
      mimeType: input.mimeType,
      extension,
      byteLength,
      persist,
      failureType: kind === "pdf" ? "pdf_extraction_failed" : "spreadsheet_read_failed",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { status: 422, body: { message: inspectFailureMessage(kind) } };
  }
}
