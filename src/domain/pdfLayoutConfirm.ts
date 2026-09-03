import { detectGroupHeaders, matchImportedGroup, type GroupCandidate } from "./groupMatch";
import { isIgnoredPdfLine, lineCells, type ExtractedPdfPage } from "./pdfExtraction";
import { previewFromSheets, type PreviewRow, type PreviewSheet, type StatementPreview } from "./workbook";

export type PdfLayoutLine = {
  pageNumber: number;
  lineNumber: number;
  text: string;
};

export type PdfLayoutSelection = {
  headerPageNumber: number;
  headerLineNumber: number;
  dataStartPageNumber: number;
  dataStartLineNumber: number;
  dataEndPageNumber: number;
  dataEndLineNumber: number;
};

export type PdfLayoutConfirmResult = {
  preview: StatementPreview;
  headerCells: string[];
  selectedLineCount: number;
  ignoredLineCount: number;
};

export function flattenExtractedPdfLines(pages: ExtractedPdfPage[]): PdfLayoutLine[] {
  return pages.flatMap((page) => {
    const lines = page.lines.length > 0 ? page.lines : [];
    return lines.map((text, index) => ({
      pageNumber: page.pageNumber,
      lineNumber: index + 1,
      text,
    }));
  });
}

export function pdfLinePosition(pageNumber: number, lineNumber: number) {
  return pageNumber * 100_000 + lineNumber;
}

export function findExtractedPdfLine(pages: ExtractedPdfPage[], pageNumber: number, lineNumber: number) {
  return flattenExtractedPdfLines(pages).find(
    (line) => line.pageNumber === pageNumber && line.lineNumber === lineNumber,
  ) ?? null;
}

export function validatePdfLayoutSelection(pages: ExtractedPdfPage[], selection: PdfLayoutSelection) {
  const header = findExtractedPdfLine(pages, selection.headerPageNumber, selection.headerLineNumber);
  if (!header) return "Choose the header row that shows the column names.";
  const headerCells = lineCells(header.text);
  if (headerCells.length < 2) {
    return "Choose a header row that shows the column names, with space between each name.";
  }
  const start = findExtractedPdfLine(pages, selection.dataStartPageNumber, selection.dataStartLineNumber);
  if (!start) return "Choose where the commission rows begin.";
  const end = findExtractedPdfLine(pages, selection.dataEndPageNumber, selection.dataEndLineNumber);
  if (!end) return "Choose where the commission rows end.";
  if (pdfLinePosition(start.pageNumber, start.lineNumber) < pdfLinePosition(header.pageNumber, header.lineNumber)) {
    return "The first commission row needs to be on or after the header row.";
  }
  if (pdfLinePosition(end.pageNumber, end.lineNumber) < pdfLinePosition(start.pageNumber, start.lineNumber)) {
    return "The last commission row needs to be on or after the first commission row.";
  }
  return null;
}

export function previewFromConfirmedPdfLayout(
  pages: ExtractedPdfPage[],
  selection: PdfLayoutSelection,
  groups: GroupCandidate[] = [],
): PdfLayoutConfirmResult {
  const problem = validatePdfLayoutSelection(pages, selection);
  if (problem) {
    return {
      preview: emptyConfirmedPreview(pages),
      headerCells: [],
      selectedLineCount: 0,
      ignoredLineCount: 0,
    };
  }

  const header = findExtractedPdfLine(pages, selection.headerPageNumber, selection.headerLineNumber)!;
  const headerCells = lineCells(header.text);
  const startKey = pdfLinePosition(selection.dataStartPageNumber, selection.dataStartLineNumber);
  const endKey = pdfLinePosition(selection.dataEndPageNumber, selection.dataEndLineNumber);
  const selected = flattenExtractedPdfLines(pages).filter((line) => {
    const key = pdfLinePosition(line.pageNumber, line.lineNumber);
    return key >= startKey && key <= endKey;
  });

  const rowsByPage = new Map<number, PreviewRow[]>();
  let ignoredLineCount = 0;
  for (const line of selected) {
    const cells = lineCells(line.text);
    if (isIgnoredPdfLine(line.text, headerCells) || cells.length < 2) {
      ignoredLineCount += 1;
      continue;
    }
    const values: Record<string, string> = {};
    headerCells.forEach((column, index) => {
      values[column] = cells[index] ?? "";
    });
    const detected = detectGroupHeaders(headerCells);
    const row: PreviewRow = {
      rowNumber: line.lineNumber,
      values,
      premiumMonth: detected.premiumMonthHeader ? values[detected.premiumMonthHeader] || null : null,
      group: matchImportedGroup(
        groups,
        detected.groupNameHeader ? values[detected.groupNameHeader] : null,
        detected.groupNumberHeader ? values[detected.groupNumberHeader] : null,
      ),
      pageNumber: line.pageNumber,
      sourceIdentity: `pdf:page:${line.pageNumber}:row:${line.lineNumber}`,
    };
    const pageRows = rowsByPage.get(line.pageNumber) ?? [];
    pageRows.push(row);
    rowsByPage.set(line.pageNumber, pageRows);
  }

  const detected = detectGroupHeaders(headerCells);
  const sheets: PreviewSheet[] = [...rowsByPage.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([pageNumber, rows]) => ({
      name: `Page ${pageNumber}`,
      headerRowNumber: selection.headerPageNumber === pageNumber ? selection.headerLineNumber : 1,
      rowCount: rows.length,
      headers: headerCells,
      ...detected,
      rows,
    }));

  const preview = previewFromSheets(sheets);
  return {
    preview,
    headerCells,
    selectedLineCount: selected.length,
    ignoredLineCount,
  };
}

function emptyConfirmedPreview(pages: ExtractedPdfPage[]): StatementPreview {
  return {
    sheets: [],
    unmatchedGroups: [],
    rowCount: 0,
    newGroupCount: 0,
    pdf: {
      classification: "needs_layout",
      pageCount: pages.length,
    },
  };
}
