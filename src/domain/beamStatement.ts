import { matchCarrierGroupIdentity, type CarrierGroupIdentity } from "./carrierGroupIdentity";
import type { ColumnMapping } from "./columnMapping";
import type { GroupCandidate } from "./groupMatch";
import { moneyToken, type ExtractedPdfPage } from "./pdfExtraction";
import { previewFromSheets, type PreviewRow, type StatementPreview } from "./workbook";

export const BEAM_HEADERS = {
  groupName: "Company Name",
  groupNumber: "Group Number",
  policy: "Policy",
  premium: "Premium",
  commission: "Comm. amt.",
  invoicingPeriod: "Invoicing Period",
  sourceContext: "Source context",
} as const;

export const BEAM_GROUP_NUMBER = /^CA\d{5}$/i;

export type BeamMatchContext = {
  carrierId?: number | null;
  identities?: CarrierGroupIdentity[];
  sourceHint?: string | null;
};

export type BeamRecord = {
  groupName: string;
  groupNumber: string;
  policy: string;
  premium: string | null;
  commission: string;
  invoicingPeriod: string;
  sourceText: string;
};

const ignoredLine = /^(commission statement|commission (period|summary|adjustments)|group business( total)?$|you get:|date:|beam support|learn more|company name(\s+policy)?|if you have questions|disability products|paid by the hartford|page\s+\d+|total$|subtotal|confidential)/i;
const beamBrand = /beambenefits|\bbeam\s+(support|benefits)\b|^beam\b/i;
const rateFormula = /\d(?:\.\d+)?\s*x\s*\d+(?:\.\d+)?%\s*=/;
const isoDate = /(\d{4}-\d{2}-\d{2})/;
const policyHint = /smartpremium|vsp\s+choice|shelf-rated|\boon\b|choice plan|#\d|^\(?\d[\d./-]*|\(\d/i;

function isMoney(value: string) {
  return moneyToken.test(value.replace(/\s/g, ""));
}

export function isBeamGroupNumber(value: string | null | undefined) {
  return BEAM_GROUP_NUMBER.test((value ?? "").trim());
}

function moneyCells(cells: string[]) {
  return cells.filter((cell) => isMoney(cell));
}

function dateText(value: string) {
  const match = value.match(isoDate);
  return match?.[1] ?? null;
}

function isIgnoredBeamLine(line: string) {
  const text = line.trim();
  if (!text) return true;
  if (ignoredLine.test(text)) return true;
  if (beamBrand.test(text) && !isMoney(text) && !isBeamGroupNumber(text)) return true;
  if (/adminsupport@beambenefits|thehartford\.com/i.test(text)) return true;
  return false;
}

function joinName(base: string, fragment: string) {
  const left = base.trim();
  const right = fragment.trim();
  if (!left) return right;
  if (!right) return left;
  if (left.toLowerCase().endsWith(right.toLowerCase())) return left;
  if (left.endsWith("&") || left.endsWith("-")) return `${left} ${right}`;
  return `${left} ${right}`;
}

function joinPolicy(base: string, fragment: string) {
  const left = base.trim();
  const right = fragment.trim();
  if (!left) return right;
  if (!right) return left;
  if (left.toLowerCase().includes(right.toLowerCase())) return left;
  if (left.endsWith("-")) return `${left}${right}`;
  return `${left} ${right}`;
}

function joinPeriod(base: string, fragment: string) {
  const left = base.trim();
  const right = fragment.trim();
  if (!left) return right;
  if (!right || left.includes(right)) return left;
  return `${left.replace(/\s*-\s*$/, "")} - ${right}`;
}

function isPolicyFragment(value: string) {
  const text = value.trim();
  if (!text || isMoney(text) || isBeamGroupNumber(text) || dateText(text)) return false;
  if (policyHint.test(text)) return true;
  if (/^\d{3,5}[a-z]?$/i.test(text)) return true;
  return false;
}

function isNameFragment(value: string) {
  const text = value.trim();
  if (!text || isMoney(text) || isBeamGroupNumber(text) || dateText(text) || isPolicyFragment(text)) return false;
  if (rateFormula.test(text) || ignoredLine.test(text)) return false;
  return /[A-Za-z]/.test(text);
}

function isCompanyNameStart(value: string) {
  const text = value.trim();
  if (!text || isMoney(text) || isBeamGroupNumber(text) || dateText(text) || isPolicyFragment(text)) return false;
  if (/^company name$/i.test(text) || ignoredLine.test(text)) return false;
  return /[A-Za-z]/.test(text);
}

function cellsFromLine(line: string) {
  if (line.includes("\t")) return line.split("\t").map((cell) => cell.trim()).filter(Boolean);
  return line.split(/\s{2,}|\s\|\s/).map((cell) => cell.trim()).filter(Boolean);
}

export function looksLikeBeamStatement(pages: ExtractedPdfPage[], hint?: string | null) {
  const text = [hint ?? "", ...pages.map((page) => [page.text, ...(page.lines ?? [])].join("\n"))].join("\n");
  if (/choice\s*builder/i.test(text) && !/beam/i.test(text)) return false;
  if (/cal(?:ifornia)?\s*choice/i.test(text) && !/beam/i.test(text)) return false;
  const groupNumbers = text.match(/\bCA\d{5}\b/gi) ?? [];
  if (/beambenefits|\bbeam\s+benefits\b|\bbeam\s+commission\b/i.test(text)) return true;
  if (/company name/i.test(text) && /comm\.?\s*amt/i.test(text) && groupNumbers.length >= 2) return true;
  return groupNumbers.length >= 3 && /invoicing period/i.test(text);
}

export function previewLooksLikeMisreadBeam(preview: Pick<StatementPreview, "sheets" | "unmatchedGroups"> | null | undefined) {
  const names = [
    ...(preview?.unmatchedGroups ?? []).map((group) => group.sourceName),
    ...(preview?.sheets ?? []).flatMap((sheet) => sheet.rows.flatMap((row) => [
      sheet.groupNameHeader ? row.values[sheet.groupNameHeader] : null,
      row.group?.sourceName,
    ])),
  ];
  return names.some((value) => isBeamGroupNumber(value));
}

function emptyRecord(): BeamRecord {
  return {
    groupName: "",
    groupNumber: "",
    policy: "",
    premium: null,
    commission: "",
    invoicingPeriod: "",
    sourceText: "",
  };
}

function attachCells(record: BeamRecord, cells: string[], line: string) {
  record.sourceText = record.sourceText ? `${record.sourceText}\n${line}` : line;
  for (const cell of cells) {
    if (isBeamGroupNumber(cell)) {
      record.groupNumber = cell.trim().toUpperCase();
      continue;
    }
    const dated = dateText(cell);
    if (dated) {
      record.invoicingPeriod = joinPeriod(record.invoicingPeriod, dated);
      continue;
    }
    if (isMoney(cell)) continue;
    if (rateFormula.test(cell)) continue;
    if (isPolicyFragment(cell)) {
      record.policy = joinPolicy(record.policy, cell);
      continue;
    }
    if (isNameFragment(cell)) {
      record.groupName = joinName(record.groupName, cell);
    }
  }
}

function startRecord(cells: string[], line: string): BeamRecord {
  const moneys = moneyCells(cells);
  const record = emptyRecord();
  record.commission = moneys[moneys.length - 1] ?? "";
  record.premium = moneys.length >= 2 ? moneys[moneys.length - 2]! : null;
  const first = cells[0] ?? "";
  if (isCompanyNameStart(first)) record.groupName = first.trim();
  attachCells(record, cells.slice(1), line);
  record.sourceText = line;
  return record;
}

function isRecordStart(cells: string[]) {
  return moneyCells(cells).length >= 2 && isCompanyNameStart(cells[0] ?? "");
}

export function parseBeamLines(lines: string[]): BeamRecord[] {
  const records: BeamRecord[] = [];
  let current: BeamRecord | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || isIgnoredBeamLine(line)) continue;
    const cells = cellsFromLine(line);
    if (cells.length === 0) continue;

    if (isRecordStart(cells)) {
      if (current?.commission) records.push(current);
      current = startRecord(cells, line);
      continue;
    }

    if (!current) continue;
    attachCells(current, cells, line);
  }

  if (current?.commission) records.push(current);
  return records.filter((record) => record.groupName && record.commission && !isBeamGroupNumber(record.groupName));
}

export function interpretBeamStatement(
  pages: ExtractedPdfPage[],
  groups: GroupCandidate[] = [],
  context: BeamMatchContext = {},
): { preview: StatementPreview; mapping: ColumnMapping; inferred: true } | null {
  if (!looksLikeBeamStatement(pages, context.sourceHint)) return null;
  const records: Array<BeamRecord & { pageNumber: number; lineNumber: number }> = [];
  for (const page of pages) {
    const lines = page.lines.length > 0 ? page.lines : page.text.split(/\r?\n/);
    parseBeamLines(lines).forEach((record, index) => {
      records.push({
        ...record,
        pageNumber: page.pageNumber,
        lineNumber: index + 1,
      });
    });
  }
  if (records.length === 0) return null;

  const headers = [
    BEAM_HEADERS.groupName,
    BEAM_HEADERS.groupNumber,
    BEAM_HEADERS.policy,
    BEAM_HEADERS.premium,
    BEAM_HEADERS.commission,
    BEAM_HEADERS.invoicingPeriod,
    BEAM_HEADERS.sourceContext,
  ];
  const rows: PreviewRow[] = records.map((record, index) => {
    const values = {
      [BEAM_HEADERS.groupName]: record.groupName,
      [BEAM_HEADERS.groupNumber]: record.groupNumber,
      [BEAM_HEADERS.policy]: record.policy,
      [BEAM_HEADERS.premium]: record.premium ?? "",
      [BEAM_HEADERS.commission]: record.commission,
      [BEAM_HEADERS.invoicingPeriod]: record.invoicingPeriod,
      [BEAM_HEADERS.sourceContext]: record.sourceText,
    };
    return {
      rowNumber: index + 1,
      values,
      premiumMonth: record.invoicingPeriod || null,
      group: matchCarrierGroupIdentity(groups, record.groupName, record.groupNumber, {
        carrierId: context.carrierId,
        identities: context.identities,
        requireNameConfirmation: true,
      }),
      pageNumber: record.pageNumber,
      sourceIdentity: `pdf:page:${record.pageNumber}:row:${record.lineNumber}`,
    };
  });
  const preview = previewFromSheets([{
    name: "Page 1",
    headerRowNumber: 1,
    rowCount: rows.length,
    headers,
    groupNameHeader: BEAM_HEADERS.groupName,
    groupNumberHeader: BEAM_HEADERS.groupNumber,
    premiumMonthHeader: BEAM_HEADERS.invoicingPeriod,
    rows,
  }]);
  return {
    preview: {
      ...preview,
      pdf: {
        classification: "readable",
        pageCount: pages.length,
        groupMatchStrategy: "carrier_group_identity",
        layoutName: "Beam",
      },
    },
    mapping: {
      groupName: BEAM_HEADERS.groupName,
      groupNumber: BEAM_HEADERS.groupNumber,
      lineOfBusiness: BEAM_HEADERS.policy,
      premium: BEAM_HEADERS.premium,
      grossCommission: BEAM_HEADERS.commission,
      premiumMonth: BEAM_HEADERS.invoicingPeriod,
      notes: BEAM_HEADERS.sourceContext,
    },
    inferred: true,
  };
}
