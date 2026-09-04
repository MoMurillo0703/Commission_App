import { parseFlexibleMonth } from "./dates";
import { detectGroupHeaders, matchImportedGroup, type GroupCandidate } from "./groupMatch";
import {
  candidateRowsFromPdfPages,
  isIgnoredPdfLine,
  lineCells,
  moneyToken,
  type ExtractedPdfPage,
} from "./pdfExtraction";
import { suggestColumnMapping, type ColumnMapping } from "./columnMapping";
import { previewFromSheets, type PreviewRow, type PreviewSheet, type StatementPreview } from "./workbook";

const coverageWord = /^(medical|dental|vision|life|disability|pharmacy|rx|stop[\s-]?loss|vol(\.|untary)?|acc(ident)?|std|ltd|vis|med|den|chiropractic)$/i;
const commissionHeader = /^(fee|commission|comm\.?|earned|comm(ission)?\s*amount|comm amt)$/i;
const premiumHeader = /^(paid|premium|billed|volume)$/i;
const groupNameHeader = /^(member|group(\s*name)?|company(\s*name)?|client|employer|account|subscriber|customer|name)$/i;
const groupNumberHeader = /^(group\s*(number|no\.?|#|id)|member\s*(id|number)|account\s*(number|id)|policy\s*(number|no\.?|#|id)|id|#)$/i;
const lineHeader = /^(plan|lob|product|coverage|benefit|line)$/i;
const monthHeader = /^(month|period|coverage month|premium month|paid month)$/i;
const policyLine = /^policy\s*(number|no\.?|#)\s*[:#]?\s*([A-Za-z0-9-]+)\s*$/i;
const inheritedPolicyHeader = "Policy Number";

export type PdfStructureInference = {
  preview: StatementPreview;
  mapping: ColumnMapping;
  headerCells: string[];
  inferred: true;
};

function isMoney(value: string) {
  return moneyToken.test(value.replace(/\s/g, ""));
}

function isMonthValue(value: string) {
  return parseFlexibleMonth(value) != null;
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
  const monthHits = usable.filter((value) => isMonthValue(value)).length;
  if (monthHits / usable.length >= 0.8) return "month";
  const coverageHits = usable.filter((value) => coverageWord.test(value) || /^[A-Za-z]{2,5}$/.test(value)).length;
  if (coverageHits / usable.length >= 0.8) return "coverage";
  const numberHits = usable.filter((value) => /[0-9]/.test(value) && value.length <= 16 && !isMonthValue(value)).length;
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
  if (!mapping.premiumMonth) {
    mapping.premiumMonth = columns.find((column) => column.kind === "month")?.header ?? null;
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

function parsePolicyNumber(text: string) {
  const match = text.trim().match(policyLine);
  return match?.[2] ?? null;
}

function assignRowValues(headers: string[], cells: string[], mapping: ColumnMapping) {
  const values: Record<string, string> = {};
  headers.forEach((header, index) => {
    values[header] = cells[index] ?? "";
  });
  const unused = [...cells];
  const take = (predicate: (cell: string) => boolean) => {
    const index = unused.findIndex(predicate);
    if (index < 0) return "";
    return unused.splice(index, 1)[0] ?? "";
  };
  if (mapping.grossCommission) {
    const money = cells.filter((cell) => isMoney(cell));
    if (money.length === 1) values[mapping.grossCommission] = money[0] ?? "";
  }
  if (mapping.premiumMonth) {
    const month = take((cell) => isMonthValue(cell));
    if (month) values[mapping.premiumMonth] = month;
  }
  if (mapping.lineOfBusiness) {
    const current = values[mapping.lineOfBusiness] ?? "";
    const coverage = take((cell) => coverageWord.test(cell) || (/^[A-Za-z]{2,16}$/.test(cell) && !isMonthValue(cell) && !isMoney(cell)));
    if (coverage && (!current || isMoney(current) || isMonthValue(current))) {
      values[mapping.lineOfBusiness] = coverage;
    }
  }
  if (mapping.groupName) {
    const current = values[mapping.groupName] ?? "";
    const misplaced = !current || isMonthValue(current) || isMoney(current) || coverageWord.test(current);
    if (misplaced) {
      const leftover = unused.filter((cell) => cell && !isMoney(cell) && !isMonthValue(cell) && cell !== values[mapping.lineOfBusiness ?? ""]);
      values[mapping.groupName] = leftover.join(" ");
    }
  }
  return values;
}

function previewFromAssignedRows(
  pages: ExtractedPdfPage[],
  headerCells: string[],
  data: Array<{ pageNumber: number; lineNumber: number; values: Record<string, string> }>,
  groups: GroupCandidate[],
  mapping: ColumnMapping,
): StatementPreview {
  const detected = detectGroupHeaders(headerCells);
  const groupNameHeaderResolved = mapping.groupName ?? detected.groupNameHeader;
  const groupNumberHeaderResolved = mapping.groupNumber ?? detected.groupNumberHeader;
  const rowsByPage = new Map<number, PreviewRow[]>();
  data.forEach((item, index) => {
    const values = item.values;
    const row: PreviewRow = {
      rowNumber: index + 1,
      values,
      premiumMonth: mapping.premiumMonth ? values[mapping.premiumMonth] || null : detected.premiumMonthHeader ? values[detected.premiumMonthHeader] || null : null,
      group: matchImportedGroup(
        groups,
        groupNameHeaderResolved ? values[groupNameHeaderResolved] || null : null,
        groupNumberHeaderResolved ? values[groupNumberHeaderResolved] || null : null,
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
      groupNameHeader: groupNameHeaderResolved,
      groupNumberHeader: groupNumberHeaderResolved,
      premiumMonthHeader: mapping.premiumMonth ?? detected.premiumMonthHeader,
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

  type ClusterItem =
    | { kind: "policy"; pageNumber: number; lineNumber: number; policyNumber: string }
    | { kind: "data"; pageNumber: number; lineNumber: number; cells: string[] };
  const clusters: Array<{ headerCells: string[]; items: ClusterItem[] }> = [];
  let current: { headerCells: string[]; items: ClusterItem[] } | null = null;

  for (const line of lines) {
    const policyNumber = parsePolicyNumber(line.text);
    if (policyNumber) {
      if (!current) current = { headerCells: [], items: [] };
      current.items.push({ kind: "policy", pageNumber: line.pageNumber, lineNumber: line.lineNumber, policyNumber });
      continue;
    }
    if (isIgnoredPdfLine(line.text, current?.headerCells ?? [])) continue;
    const moneyCount = line.cells.filter((cell) => isMoney(cell)).length;
    const headerLike = line.cells.length >= 3 && moneyCount === 0 && line.cells.every((cell) => cell.length <= 24);
    if (headerLike) {
      if (current && current.headerCells.length > 0 && current.items.some((item) => item.kind === "data")) {
        clusters.push(current);
        current = { headerCells: line.cells, items: [] };
      } else if (current && current.headerCells.length === 0) {
        current.headerCells = line.cells;
      } else {
        current = { headerCells: line.cells, items: [] };
      }
      continue;
    }
    if (!current || current.headerCells.length === 0) continue;
    if (moneyCount === 0) continue;
    current.items.push({ kind: "data", pageNumber: line.pageNumber, lineNumber: line.lineNumber, cells: line.cells });
  }
  if (current && current.headerCells.length > 0 && current.items.some((item) => item.kind === "data")) {
    clusters.push(current);
  }

  const ranked = clusters
    .map((cluster) => {
      const positional = cluster.items.filter((item) => item.kind === "data").map((item) => item.cells);
      const mapping = completeMapping(cluster.headerCells, positional);
      const hasPolicy = cluster.items.some((item) => item.kind === "policy");
      return {
        ...cluster,
        mapping,
        score: positional.length + (mappingIsUsable(mapping) ? 10 : 0) + (mapping.premiumMonth ? 2 : 0) + (hasPolicy ? 2 : 0),
      };
    })
    .filter((cluster) => mappingIsUsable(cluster.mapping))
    .sort((left, right) => right.score - left.score);

  const best = ranked[0];
  if (!best) return null;

  const headers = [...best.headerCells];
  const mapping = { ...best.mapping };
  if (!mapping.groupNumber && best.items.some((item) => item.kind === "policy")) {
    headers.push(inheritedPolicyHeader);
    mapping.groupNumber = inheritedPolicyHeader;
  }

  let lastName = "";
  let lastNumber = "";
  const assigned: Array<{ pageNumber: number; lineNumber: number; values: Record<string, string> }> = [];
  for (const item of best.items) {
    if (item.kind === "policy") {
      lastNumber = item.policyNumber;
      continue;
    }
    const values = assignRowValues(headers, item.cells, mapping);
    if (mapping.groupName) {
      if (values[mapping.groupName]) lastName = values[mapping.groupName];
      else if (lastName) values[mapping.groupName] = lastName;
    }
    if (mapping.groupNumber) {
      if (values[mapping.groupNumber]) lastNumber = values[mapping.groupNumber];
      else if (lastNumber) values[mapping.groupNumber] = lastNumber;
    }
    if (!(mapping.groupName && values[mapping.groupName]) && !(mapping.groupNumber && values[mapping.groupNumber])) continue;
    if (mapping.grossCommission && !values[mapping.grossCommission]) continue;
    assigned.push({ pageNumber: item.pageNumber, lineNumber: item.lineNumber, values });
  }

  if (assigned.length === 0) return null;
  const preview = previewFromAssignedRows(pages, headers, assigned, groups, mapping);
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
      ...suggestColumnMapping(headers),
      ...mapping,
    },
    headerCells: headers,
    inferred: true,
  };
}

export function interpretExtractedPdfPages(
  pages: ExtractedPdfPage[],
  groups: GroupCandidate[] = [],
) {
  const firstPass = candidateRowsFromPdfPages(pages, groups);
  const inferred = inferPdfStatementStructure(pages, groups);
  if (inferred && inferred.preview.rowCount > 0 && inferred.preview.rowCount >= firstPass.rowCount) {
    return {
      preview: inferred.preview,
      mapping: inferred.mapping,
      inferred: true as const,
    };
  }
  if (firstPass.rowCount > 0) {
    return {
      preview: firstPass,
      mapping: suggestColumnMapping(firstPass.sheets.flatMap((sheet) => sheet.headers)),
      inferred: false as const,
    };
  }
  return null;
}
