import { extractText, extractTextItems, getDocumentProxy } from "unpdf";
import { statementInspectLog } from "@/domain/statementInspect";
import {
  candidateRowsFromPdfPages,
  classifyPdfText,
  linesFromTextItems,
  splitPdfLines,
  type ExtractedPdfPage,
  type PdfExtractionResult,
} from "@/domain/pdfExtraction";
import { inferPdfStatementStructure } from "@/domain/pdfStructureInference";
import { omitStatementCompensationMapping, suggestColumnMapping, type ColumnMapping } from "@/domain/columnMapping";
import type { GroupCandidate } from "@/domain/groupMatch";
import type { StatementPreview } from "@/domain/workbook";

export async function extractPdfPages(contents: ArrayBuffer | Uint8Array): Promise<PdfExtractionResult> {
  const bytes = contents instanceof Uint8Array ? Uint8Array.from(contents) : new Uint8Array(contents);
  try {
    const pdf = await getDocumentProxy(bytes);
    if (pdf.numPages > 200) {
      return {
        classification: "failed",
        pages: [],
        characterCount: 0,
        message: "This PDF has more than 200 pages and was not processed. The original file has been saved.",
      };
    }
    const extracted = await extractText(pdf, { mergePages: false });
    const positioned = await extractTextItems(pdf);
    const texts = Array.isArray(extracted.text) ? extracted.text : [extracted.text];
    const pages: ExtractedPdfPage[] = texts.map((text, index) => {
      const items = positioned.items[index] ?? [];
      const lines = items.length > 0 ? linesFromTextItems(items) : splitPdfLines(String(text ?? ""));
      return {
        pageNumber: index + 1,
        text: lines.join("\n") || String(text ?? ""),
        lines,
      };
    });
    return { pages, ...classifyPdfText(pages) };
  } catch {
    statementInspectLog({
      outcome: "pdf_extraction_exception",
      classifiedAs: "pdf",
      mimeType: "application/pdf",
      extension: ".pdf",
      byteLength: bytes.byteLength,
      persist: false,
      failureType: "unpdf_runtime",
      errorName: "Error",
    });
    return {
      classification: "failed",
      pages: [],
      characterCount: 0,
      message: "PDF extraction failed — original retained.",
    };
  }
}

export async function previewPdfStatement(
  contents: ArrayBuffer | Uint8Array,
  groups: GroupCandidate[],
): Promise<{ extraction: PdfExtractionResult; preview: StatementPreview; mapping?: ColumnMapping | null }> {
  const extraction = await extractPdfPages(contents);
  if (extraction.classification !== "readable") {
    return {
      extraction,
      preview: {
        sheets: [],
        unmatchedGroups: [],
        rowCount: 0,
        newGroupCount: 0,
        pdf: {
          classification: extraction.classification === "failed" ? "failed" : "unreadable",
          pageCount: extraction.pages.length,
        },
      },
    };
  }

  const firstPass = candidateRowsFromPdfPages(extraction.pages, groups);
  if (firstPass.rowCount > 0) {
    return {
      extraction,
      preview: {
        ...firstPass,
        pdf: {
          classification: "readable",
          pageCount: extraction.pages.length,
        },
      },
      mapping: omitStatementCompensationMapping(suggestColumnMapping(firstPass.sheets.flatMap((sheet) => sheet.headers))),
    };
  }

  const inferred = inferPdfStatementStructure(extraction.pages, groups);
  if (inferred) {
    return { extraction, preview: inferred.preview, mapping: omitStatementCompensationMapping(inferred.mapping) };
  }

  return {
    extraction,
    preview: {
      ...firstPass,
      pdf: {
        classification: "needs_layout",
        pageCount: extraction.pages.length,
      },
    },
  };
}
