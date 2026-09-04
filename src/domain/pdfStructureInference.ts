import { detectGroupHeaders, matchImportedGroup, type GroupCandidate } from "./groupMatch";
import {
  isIgnoredPdfLine,
  lineCells,
  moneyToken,
  type ExtractedPdfPage,
} from "./pdfExtraction";
import { suggestColumnMapping, type ColumnMapping } from "./columnMapping";
import { previewFromSheets, type PreviewRow, type PreviewSheet, type StatementPreview } from "./workbook";

const coverageWord = /^(medical|dental|vision|life|disability|pharmacy|rx|stop[\s-]?loss|vol(\.|untary)?|acc(ident)?|std|ltd|vis|med|den)$/i;
const commissionHeader = /^(fee|commission|comm\.?|earned|comm amt)$/i;
const premiumHeader = /^(paid|premium|billed|volume)$/i;
const groupNameHeader = /^(member|group(\s*name)?|client|employer|account|subscriber|name)$/i;
const groupNumberHeader = /^(group\s*(number|no\.?|#|id)|member\s*(id|number)|account\s*(number|id)|id|#)$/i;
const lineHeader = /^(plan|lob|product|coverage|benefit|line)$/i;
const monthHeader = /^(month|period|coverage month|premium month)$/i;

export type PdfStructureInference = {
  preview: StatementPreview;
  mapping: ColumnMapping;
  headerCells: string[];
  inferred: true;
};

function isMoney(value: string) {
  return moneyToken.test(value.replace(/\s/g, ""));
}

function cellsForInference(line: string) {
  const wide = lineCells(line);
  if (wide.length >= 3) return wide;
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  const moneyIndexes = tokens.flatMap((token, index) => (isMoney(token) ? [index] : []));
  if (moneyIndexes.length === 2 && moneyIndexes[1] === tokens.length - 1 && moneyIndexes[0] === tokens.length - 2 && tokens.length >= 4) {
    const plan = tokens[tokens.length - 3] ?? "";
    const name = tokens.slice(0, tokens.length - 3).join(" ");
    if (name && (coverageWord.test(plan) || /^[A-Za-z0-9]{2,6}$/.test(plan))) {
      return [name, plan, tokens[tokens.length - 2]!, tokens[tokens.length - 1]!];
    }
  }
  return wide;
}

function interpretHeaders(headers: string[]): ColumnMapping {
  const find = (pattern: RegExp) => headers.find((header) => pattern.test(header.trim())) ?? null;
  return {
    groupName: find(groupNameHeader),
    groupNumber: find(groupNumberHeader),
    lineOfBusiness: find(lineHeader),
    premium: find(premiumHeader),
    grossCommission: find(commissionHeader),
    premiumMonth: find(monthHeader),
  };
}

function classifyColumn(values: string[]) {
  const usable = values.filter((value) => value.trim());
  if (usable.length === 0) return "unknown";
  const moneyHits = usable.filter((value) => isMoney(value)).length;
  if (moneyHits / usable.length >= 0.8) return "money";
  const coverageHits = usable.filter((value) => coverageWord.test(value) || /^[A-Za-z]{2,5}$/.test(value)).length;
  if (coverageHits / usable.length >= 0.8) return "coverage";
  const numberHits = usable.filter((value) => /[0-9]/.test(value) && value.length <= 16).length;
  if (numberHits / usable.length >= 0.8) return "number";
  return "name";
}

function completeMapping(headers: string[], dataRows: string[][]): ColumnMapping {
  const mapping = interpretHeaders(headers);
  const columns = headers.map((header, index) => ({
    header,
    kind: classifyColumn(dataRows.map((row) => row[index] ?? "")),
  }));
  const moneyHeaders = columns.filter((column) => column.kind === "money").map((column) => column.header);
  if (!mapping.grossCommission && moneyHeaders.length === 1) {
    mapping.grossCommission = moneyHeaders[0];
  }
  if (!mapping.groupName) {
    mapping.groupName = columns.find((column) => column.kind === "name")?.header ?? null;
  }
  if (!mapping.groupNumber) {
    mapping.groupNumber = columns.find((column) => column.kind === "number")?.header ?? null;
  }
  if (!mapping.lineOfBusiness) {
    mapping.lineOfBusiness = columns.find((column) => column.kind === "coverage")?.header ?? null;
  }
  return mapping;
}

function mappingIsUsable(mapping: ColumnMapping) {
  return Boolean((mapping.groupName || mapping.groupNumber) && mapping.grossCommission);
}

function previewFromCluster(
  pages: ExtractedPdfPage[],
  headerCells: string[],
  data: Array<{ pageNumber: number; lineNumber: number; cells: string[] }>,
  groups: GroupCandidate[],
): StatementPreview {
  const detected = detectGroupHeaders(headerCells);
  const rowsByPage = new Map<number, PreviewRow[]>();
  data.forEach((item, index) => {
    const values: Record<string, string> = {};
    headerCells.forEach((header, column) => {
      values[header] = item.cells[column] ?? "";
    });
    const row: PreviewRow = {
      rowNumber: index + 1,
      values,
      premiumMonth: detected.premiumMonthHeader ? values[detected.premiumMonthHeader] || null : null,
      group: matchImportedGroup(
        groups,
        detected.groupNameHeader ? values[detected.groupNameHeader] : values[headerCells[0] ?? ""] || null,
        detected.groupNumberHeader ? values[detected.groupNumberHeader] : null,
      ),
      pageNumber: item.pageNumber,
      sourceIdentity: `pdf:page:${item.pageNumber}:row:${item.lineNumber}`,
    };
    const pageRows = rowsByPage.get(item.pageNumber) ?? [];
    pageRows.push(row);
    rowsByPage.set(item.pageNumber, pageRows);
  });
  const sheets: PreviewSheet[] = [...rowsByPage.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([pageNumber, rows]) => ({
      name: `Page ${pageNumber}`,
      headerRowNumber: 1,
      rowCount: rows.length,
      headers: headerCells,
      ...detected,
      rows,
    }));
  return previewFromSheets(sheets);
}

export function inferPdfStatementStructure(
  pages: ExtractedPdfPage[],
  groups: GroupCandidate[] = [],
): PdfStructureInference | null {
  const lines = pages.flatMap((page) => {
    const textLines = page.lines.length > 0 ? page.lines : [];
    return textLines.map((text, index) => ({
      pageNumber: page.pageNumber,
      lineNumber: index + 1,
      text,
      cells: cellsForInference(text),
    }));
  });

  const clusters: Array<{ headerCells: string[]; data: Array<{ pageNumber: number; lineNumber: number; cells: string[] }> }> = [];
  let current: { headerCells: string[]; data: Array<{ pageNumber: number; lineNumber: number; cells: string[] }> } | null = null;

  for (const line of lines) {
    if (isIgnoredPdfLine(line.text, current?.headerCells ?? [])) continue;
    const moneyCount = line.cells.filter((cell) => isMoney(cell)).length;
    const headerLike = line.cells.length >= 3 && moneyCount === 0 && line.cells.every((cell) => cell.length <= 24);
    if (headerLike) {
      if (current && current.data.length > 0) clusters.push(current);
      current = { headerCells: line.cells, data: [] };
      continue;
    }
    if (!current) continue;
    if (moneyCount === 0) continue;
    if (line.cells.length < Math.max(2, current.headerCells.length - 1)) continue;
    current.data.push({ pageNumber: line.pageNumber, lineNumber: line.lineNumber, cells: line.cells });
  }
  if (current && current.data.length > 0) clusters.push(current);

  const ranked = clusters
    .map((cluster) => {
      const mapping = completeMapping(cluster.headerCells, cluster.data.map((row) => row.cells));
      return { ...cluster, mapping, score: cluster.data.length + (mappingIsUsable(mapping) ? 10 : 0) };
    })
    .filter((cluster) => mappingIsUsable(cluster.mapping))
    .sort((left, right) => right.score - left.score);

  const best = ranked[0];
  if (!best) return null;
  const preview = previewFromCluster(pages, best.headerCells, best.data, groups);
  if (preview.rowCount === 0) return null;
  return {
    preview: {
      ...preview,
      pdf: {
        classification: "readable",
        pageCount: pages.length,
      },
    },
    mapping: {
      ...suggestColumnMapping(best.headerCells),
      ...best.mapping,
    },
    headerCells: best.headerCells,
    inferred: true,
  };
}
