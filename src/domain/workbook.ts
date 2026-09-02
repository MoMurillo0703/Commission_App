import ExcelJS from "exceljs";
import { detectGroupHeaders, matchImportedGroup, unmatchedGroupKey, type GroupCandidate, type GroupMatch } from "./groupMatch";

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
};

function cellText(cell: ExcelJS.Cell) {
  return String(cell.text ?? "").trim();
}

function asExcelBuffer(contents: ArrayBuffer | Uint8Array) {
  const bytes = contents instanceof Uint8Array ? contents : new Uint8Array(contents);
  return Buffer.from(bytes) as unknown as Parameters<ExcelJS.Xlsx["load"]>[0];
}

export async function inspectWorkbook(contents: ArrayBuffer | Uint8Array): Promise<InspectedSheet[]> {
  const preview = await previewWorkbook(contents, []);
  return preview.sheets.map(({ name, rowCount, headers }) => ({ name, rowCount, headers }));
}

export async function previewWorkbook(contents: ArrayBuffer | Uint8Array, groups: GroupCandidate[]): Promise<StatementPreview> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(asExcelBuffer(contents));
  const unmatched = new Map<string, UnmatchedGroup>();
  let rowCount = 0;

  const sheets = workbook.worksheets.map((sheet) => {
    const headers: string[] = [];
    sheet.getRow(1).eachCell({ includeEmpty: false }, (cell) => {
      const header = cellText(cell);
      if (header) headers.push(header);
    });
    const detected = detectGroupHeaders(headers);
    const rows: PreviewRow[] = [];

    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const values: Record<string, string> = {};
      let hasValue = false;
      headers.forEach((header, index) => {
        const value = cellText(row.getCell(index + 1));
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
      rows.push({ rowNumber, values, premiumMonth, group });
    });

    rowCount += rows.length;
    for (const row of rows) {
      if (row.group.status !== "new_group") continue;
      const key = unmatchedGroupKey(row.group);
      const existing = unmatched.get(key);
      if (existing) existing.rowCount += 1;
      else unmatched.set(key, { sourceName: row.group.sourceName, sourceNumber: row.group.sourceNumber, rowCount: 1 });
    }

    return {
      name: sheet.name,
      rowCount: rows.length,
      headers,
      ...detected,
      rows,
    };
  });

  const unmatchedGroups = [...unmatched.values()];
  return {
    sheets,
    unmatchedGroups,
    rowCount,
    newGroupCount: unmatchedGroups.length,
  };
}
