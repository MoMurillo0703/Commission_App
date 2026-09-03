import ExcelJS from "exceljs";
import { detectGroupHeaders, matchImportedGroup, unmatchedGroupKey, type GroupCandidate, type GroupImportResolution, type GroupMatch } from "./groupMatch";

export type InspectedSheet = {
  name: string;
  rowCount: number;
  headers: string[];
};

export type PreviewRow = {
  rowNumber: number;
  values: Record<string, string>;
  premiumMonth: string | null;
  group: GroupMatch;
};

export type PreviewSheet = InspectedSheet & {
  headerRowNumber: number;
  groupNameHeader: string | null;
  groupNumberHeader: string | null;
  premiumMonthHeader: string | null;
  rows: PreviewRow[];
};

export type UnmatchedGroup = {
  sourceName: string | null;
  sourceNumber: string | null;
  rowCount: number;
};

export type StatementPreview = {
  sheets: PreviewSheet[];
  unmatchedGroups: UnmatchedGroup[];
  rowCount: number;
  newGroupCount: number;
  groupResolutions?: GroupImportResolution[];
};

function cellText(cell: ExcelJS.Cell) {
  return String(cell.text ?? "").trim();
}

function asExcelBuffer(contents: ArrayBuffer | Uint8Array) {
  const bytes = contents instanceof Uint8Array ? contents : new Uint8Array(contents);
  return Buffer.from(bytes) as unknown as Parameters<ExcelJS.Xlsx["load"]>[0];
}

function normalizedRows(rows: string[][], name: string, groups: GroupCandidate[]): PreviewSheet {
  const headerIndex = rows.findIndex((row) => {
    const populated = row.filter((value) => value.trim()).length;
    if (populated < 2) return false;
    const detected = detectGroupHeaders(row);
    const signals = row.filter((value) => /^(current|gross|total)?\s*commission|^premium( received)?$|^carrier$|^product type$|^line of business$|^producer name$/i.test(value.trim())).length;
    return Boolean(detected.groupNameHeader || detected.groupNumberHeader) || signals >= 2;
  });
  const effectiveHeaderIndex = headerIndex < 0 ? 0 : headerIndex;
  const headers = rows[effectiveHeaderIndex]?.map((value) => value.trim()).filter(Boolean) ?? [];
  const detected = detectGroupHeaders(headers);
  const previewRows: PreviewRow[] = [];

  rows.slice(effectiveHeaderIndex + 1).forEach((row, offset) => {
    const values: Record<string, string> = {};
    let hasValue = false;
    headers.forEach((header) => {
      const sourceIndex = rows[effectiveHeaderIndex].findIndex((candidate) => candidate.trim() === header);
      const value = row[sourceIndex]?.trim() ?? "";
      values[header] = value;
      if (value) hasValue = true;
    });
    if (!hasValue) return;
    const group = matchImportedGroup(
      groups,
      detected.groupNameHeader ? values[detected.groupNameHeader] : null,
      detected.groupNumberHeader ? values[detected.groupNumberHeader] : null,
    );
    const premiumMonth = detected.premiumMonthHeader ? values[detected.premiumMonthHeader] || null : null;
    previewRows.push({ rowNumber: effectiveHeaderIndex + offset + 2, values, premiumMonth, group });
  });

  return {
    name,
    headerRowNumber: effectiveHeaderIndex + 1,
    rowCount: previewRows.length,
    headers,
    ...detected,
    rows: previewRows,
  };
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

export function previewCsv(contents: ArrayBuffer | Uint8Array, groups: GroupCandidate[]): StatementPreview {
  const bytes = contents instanceof Uint8Array ? contents : new Uint8Array(contents);
  const text = new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
  return buildPreview([normalizedRows(parseCsv(text), "CSV", groups)]);
}

function buildPreview(sheets: PreviewSheet[]): StatementPreview {
  const unmatched = new Map<string, UnmatchedGroup>();
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      if (row.group.status !== "new_group") continue;
      const key = unmatchedGroupKey(row.group);
      const existing = unmatched.get(key);
      if (existing) existing.rowCount += 1;
      else unmatched.set(key, { sourceName: row.group.sourceName, sourceNumber: row.group.sourceNumber, rowCount: 1 });
    }
  }
  const unmatchedGroups = [...unmatched.values()];
  return { sheets, unmatchedGroups, rowCount: sheets.reduce((total, sheet) => total + sheet.rowCount, 0), newGroupCount: unmatchedGroups.length };
}

export async function inspectWorkbook(contents: ArrayBuffer | Uint8Array): Promise<InspectedSheet[]> {
  const preview = await previewWorkbook(contents, []);
  return preview.sheets.map(({ name, rowCount, headers }) => ({ name, rowCount, headers }));
}

export async function previewWorkbook(contents: ArrayBuffer | Uint8Array, groups: GroupCandidate[]): Promise<StatementPreview> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(asExcelBuffer(contents));
  const sheets = workbook.worksheets.map((sheet) => {
    const rows: string[][] = [];
    for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const values: string[] = [];
      for (let index = 1; index <= row.cellCount; index += 1) values.push(cellText(row.getCell(index)));
      rows.push(values);
    }
    return normalizedRows(rows, sheet.name, groups);
  });
  return buildPreview(sheets);
}
