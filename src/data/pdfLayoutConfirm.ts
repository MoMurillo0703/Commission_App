import { listGroups } from "@/data/groups";
import { extractPdfPages } from "@/data/pdfStatements";
import { getImportStatement, saveConfirmedPdfPreview, type ImportStatementView } from "@/data/statements";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import {
  flattenExtractedPdfLines,
  previewFromConfirmedPdfLayout,
  validatePdfLayoutSelection,
  type PdfLayoutLine,
  type PdfLayoutSelection,
} from "@/domain/pdfLayoutConfirm";
import type { ExtractedPdfPage } from "@/domain/pdfExtraction";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { readStatementFile } from "@/lib/storage";

export type StatementExtractionView = {
  statementId: number;
  classification: "readable" | "unreadable" | "failed" | "needs_layout";
  pageCount: number;
  pages: Array<{
    pageNumber: number;
    lines: PdfLayoutLine[];
  }>;
  message: string;
};

type StoredExtraction = {
  classification?: string;
  pageCount?: number;
  pages?: Array<{
    pageNumber?: number;
    lines?: string[];
    text?: string;
  }>;
};

function pagesFromStored(parsed: StoredExtraction): ExtractedPdfPage[] {
  return (parsed.pages ?? []).map((page, index) => {
    const lines = Array.isArray(page.lines) ? page.lines.filter((line) => typeof line === "string") : [];
    const text = typeof page.text === "string" ? page.text : lines.join("\n");
    return {
      pageNumber: Number(page.pageNumber) || index + 1,
      text,
      lines,
    };
  }).filter((page) => page.lines.length > 0 || page.text.trim().length > 0);
}

async function readStoredExtraction(extractionPath: string): Promise<ExtractedPdfPage[] | null> {
  try {
    const bytes = await readStatementFile(extractionPath);
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as StoredExtraction;
    const pages = pagesFromStored(parsed);
    return pages.length > 0 ? pages : null;
  } catch {
    return null;
  }
}

export async function loadStatementExtractionPages(
  db: AppDatabase | undefined,
  statement: ImportStatementView,
): Promise<ExtractedPdfPage[]> {
  if (statement.extractionPath) {
    const stored = await readStoredExtraction(statement.extractionPath);
    if (stored) return stored;
  }
  if (statement.storedPath && statement.sourceType === "pdf") {
    const bytes = await readStatementFile(statement.storedPath);
    const extracted = await extractPdfPages(bytes);
    if (extracted.classification === "readable" && extracted.pages.length > 0) {
      return extracted.pages;
    }
  }
  throw new ValidationError("We could not load the extracted text for this PDF.");
}

export async function getStatementExtraction(
  db: AppDatabase | undefined,
  id: number,
): Promise<StatementExtractionView> {
  const database = await resolveDb(db);
  const statement = await getImportStatement(database, id);
  if (!statement) throw new NotFoundError("Statement not found.");
  if (statement.sourceType !== "pdf") {
    throw new ValidationError("Layout review is only used for PDF statements.");
  }
  if (statement.status === "unreadable" || statement.preview?.pdf?.classification === "unreadable") {
    return {
      statementId: statement.id,
      classification: "unreadable",
      pageCount: statement.preview?.pdf?.pageCount ?? 0,
      pages: [],
      message: "This PDF appears to be scanned or image-based. Automatic reading is not supported yet. The original file has been saved.",
    };
  }
  if (statement.status === "extraction_failed" || statement.preview?.pdf?.classification === "failed") {
    return {
      statementId: statement.id,
      classification: "failed",
      pageCount: 0,
      pages: [],
      message: "PDF extraction failed — original retained.",
    };
  }

  const pages = await loadStatementExtractionPages(database, statement);
  const lines = flattenExtractedPdfLines(pages);
  const pagesView = pages.map((page) => ({
    pageNumber: page.pageNumber,
    lines: lines.filter((line) => line.pageNumber === page.pageNumber),
  }));
  return {
    statementId: statement.id,
    classification: statement.status === "needs_layout" ? "needs_layout" : "readable",
    pageCount: pages.length,
    pages: pagesView,
    message: "The app could not automatically find the commission table. Help the app read this statement if you want to mark the table.",
  };
}

export async function confirmPdfStatementLayout(
  db: AppDatabase | undefined,
  id: number,
  selection: PdfLayoutSelection,
): Promise<ImportStatementView> {
  const database = await resolveDb(db);
  const statement = await getImportStatement(database, id);
  if (!statement) throw new NotFoundError("Statement not found.");
  if (statement.sourceType !== "pdf") {
    throw new ValidationError("Layout confirmation is only used for PDF statements.");
  }
  if (statement.status === "posted" || statement.status === "partially_posted") {
    throw new ValidationError("This statement has already been posted.");
  }
  if (statement.status === "unreadable" || statement.preview?.pdf?.classification === "unreadable") {
    throw new ValidationError("This PDF appears to be scanned or image-based. Automatic reading is not supported yet.");
  }
  if (statement.status === "extraction_failed" || statement.preview?.pdf?.classification === "failed") {
    throw new ValidationError("PDF extraction failed — original retained.");
  }

  const pages = await loadStatementExtractionPages(database, statement);
  const problem = validatePdfLayoutSelection(pages, selection);
  if (problem) throw new ValidationError(problem);

  const groups = await listGroups(database);
  const generated = previewFromConfirmedPdfLayout(pages, selection, groups);
  if (generated.preview.rowCount === 0) {
    throw new ValidationError("No commission rows were found in the selected area. Adjust the header or where the data begins and ends.");
  }

  const preview = {
    ...generated.preview,
    pdf: {
      classification: "readable" as const,
      pageCount: pages.length,
      extractionPath: statement.extractionPath ?? statement.preview?.pdf?.extractionPath ?? null,
      layoutId: statement.preview?.pdf?.layoutId ?? statement.layoutId ?? null,
      layoutVersion: statement.preview?.pdf?.layoutVersion ?? statement.layoutVersion ?? null,
      layoutName: statement.preview?.pdf?.layoutName ?? null,
      layoutConfirmed: true,
      confirmedLayout: selection,
    },
  };

  return saveConfirmedPdfPreview(database, id, preview);
}
