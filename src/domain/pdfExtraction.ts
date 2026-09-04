import { detectGroupHeaders, matchImportedGroup, type GroupCandidate } from "./groupMatch";
import { previewFromSheets, type PreviewRow, type PreviewSheet, type StatementPreview } from "./workbook";

export type PdfClassification = "readable" | "unreadable" | "failed";

export type ExtractedPdfPage = {
  pageNumber: number;
  text: string;
  lines: string[];
};

export type PdfExtractionResult = {
  classification: PdfClassification;
  pages: ExtractedPdfPage[];
  characterCount: number;
  message: string;
};

const totalLine = /^(subtotal|sub-total|total|grand total|amount due|page total|commission total)\b/i;
const pageLine = /^page\s+\d+(\s+of\s+\d+)?$/i;
const footerLine = /^(confidential|continued|please remit|thank you|questions\?)/i;
export const moneyToken = /^-?\$?\d{1,3}(?:,\d{3})*(?:\.\d{2})%?$|^-?\d+\.\d{2}$/;
const headerSignals = /^(current|gross|total)?\s*commission|^premium( received)?$|^paid$|^fee$|^carrier$|^product( type| code| line)?$|^line of business$|^lob$|^coverage( code| type)?$|^plan$|^member$|^producer name$|^group(\s*(name|number|#))?$|^name\s*\/\s*group name$/i;

export type PdfTextItem = {
  str: string;
  x: number;
  y: number;
  width?: number;
};

export function linesFromTextItems(items: PdfTextItem[]) {
  const rows = new Map<number, PdfTextItem[]>();
  for (const item of items) {
    const text = item.str.trim();
    if (!text) continue;
    const key = Math.round(item.y / 3) * 3;
    const row = rows.get(key) ?? [];
    row.push(item);
    rows.set(key, row);
  }
  return [...rows.entries()]
    .sort((left, right) => right[0] - left[0])
    .map(([, row]) => {
      const ordered = row.sort((left, right) => left.x - right.x);
      return ordered.map((item, index) => {
        const previous = ordered[index - 1];
        const gap = previous ? item.x - (previous.x + (previous.width ?? 0)) : 0;
        return `${gap > 8 ? "    " : index > 0 ? " " : ""}${item.str.trim()}`;
      }).join("");
    })
    .filter(Boolean);
}

export function splitPdfLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\t/g, "  ").trim())
    .filter((line) => line.length > 0);
}

export function classifyPdfText(pages: ExtractedPdfPage[]): Pick<PdfExtractionResult, "classification" | "characterCount" | "message"> {
  const text = pages.map((page) => page.text).join("\n");
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  const words = text.split(/\s+/).filter((word) => /[A-Za-z]{3,}/.test(word)).length;
  if (letters < 40 || words < 8) {
    return {
      classification: "unreadable",
      characterCount: letters,
      message: "This PDF appears to be scanned or image-based. Automatic reading is not supported yet. The original file has been saved.",
    };
  }
  return {
    classification: "readable",
    characterCount: letters,
    message: "Text-based PDF successfully read.",
  };
}

export function isIgnoredPdfLine(line: string, headerCells: string[] = []) {
  const normalized = line.trim();
  if (!normalized) return true;
  if (totalLine.test(normalized) || pageLine.test(normalized) || footerLine.test(normalized)) return true;
  if (headerCells.length > 0 && lineCells(normalized).join("|").toLowerCase() === headerCells.join("|").toLowerCase()) return true;
  return false;
}

export function lineCells(line: string) {
  if (line.includes("\t")) return line.split("\t").map((cell) => cell.trim()).filter(Boolean);
  return line.split(/\s{2,}|\s\|\s/).map((cell) => cell.trim()).filter(Boolean);
}

export function looksLikeHeader(cells: string[]) {
  if (cells.length < 3) return false;
  const detected = detectGroupHeaders(cells);
  const signals = cells.filter((value) => headerSignals.test(value)).length;
  return Boolean(detected.groupNameHeader || detected.groupNumberHeader) || signals >= 2;
}

export function looksLikeDataRow(cells: string[], headerCount: number) {
  if (cells.length < 2) return false;
  if (cells.length < Math.max(2, headerCount - 2)) return false;
  return cells.some((cell) => moneyToken.test(cell.replace(/\s/g, "")));
}

export function candidateRowsFromPdfPages(pages: ExtractedPdfPage[], groups: GroupCandidate[]): StatementPreview {
  let inheritedHeaders: string[] = [];
  const sheets = pages.map((page) => {
    const result = sheetFromPage(page, groups, inheritedHeaders);
    if (result.headers.length > 0) inheritedHeaders = result.headers;
    return result;
  }).filter((sheet) => sheet.rows.length > 0);
  return previewFromSheets(sheets);
}

function sheetFromPage(page: ExtractedPdfPage, groups: GroupCandidate[], inheritedHeaders: string[] = []): PreviewSheet {
  const lines = page.lines.length > 0 ? page.lines : splitPdfLines(page.text);
  let headerCells: string[] = inheritedHeaders;
  const previewRows: PreviewRow[] = [];
  let rowNumber = 1;

  for (const line of lines) {
    const cells = lineCells(line);
    if (looksLikeHeader(cells)) {
      headerCells = cells;
      continue;
    }
    if (isIgnoredPdfLine(line, headerCells)) continue;
    if (headerCells.length === 0 || !looksLikeDataRow(cells, headerCells.length)) continue;
    const values: Record<string, string> = {};
    headerCells.forEach((header, index) => {
      values[header] = cells[index] ?? "";
    });
    const detected = detectGroupHeaders(headerCells);
    previewRows.push({
      rowNumber,
      values,
      premiumMonth: detected.premiumMonthHeader ? values[detected.premiumMonthHeader] || null : null,
      group: matchImportedGroup(
        groups,
        detected.groupNameHeader ? values[detected.groupNameHeader] : null,
        detected.groupNumberHeader ? values[detected.groupNumberHeader] : null,
      ),
      pageNumber: page.pageNumber,
      sourceIdentity: `pdf:page:${page.pageNumber}:row:${rowNumber}`,
    });
    rowNumber += 1;
  }

  const detected = detectGroupHeaders(headerCells);
  return {
    name: `Page ${page.pageNumber}`,
    headerRowNumber: 1,
    rowCount: previewRows.length,
    headers: headerCells,
    ...detected,
    rows: previewRows,
  };
}
