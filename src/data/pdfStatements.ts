import { extractText, extractTextItems, getDocumentProxy } from "unpdf";
import { statementInspectLog } from "@/domain/statementInspect";
import {
  classifyPdfText,
  linesFromTextItems,
  splitPdfLines,
  type ExtractedPdfPage,
  type PdfExtractionResult,
} from "@/domain/pdfExtraction";
import { interpretExtractedPdfPages } from "@/domain/pdfStructureInference";
import { omitStatementCompensationMapping, type ColumnMapping } from "@/domain/columnMapping";
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

  const interpreted = interpretExtractedPdfPages(extraction.pages, groups);
  if (interpreted) {
    return {
      extraction,
      preview: {
        ...interpreted.preview,
        pdf: {
          classification: "readable",
          pageCount: extraction.pages.length,
        },
      },
      mapping: omitStatementCompensationMapping(interpreted.mapping),
    };
  }

  return {
    extraction,
    preview: {
      sheets: [],
      unmatchedGroups: [],
      rowCount: 0,
      newGroupCount: 0,
      pdf: {
        classification: "needs_layout",
        pageCount: extraction.pages.length,
      },
    },
  };
}
