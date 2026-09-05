import type { ColumnMapping } from "./columnMapping";
import { isCoverageLabel } from "./coverageLabels";
import { parseFlexibleMonth } from "./dates";
import { matchCarrierGroupNumberFirst, type GroupCandidate } from "./groupMatch";
import { moneyToken, type ExtractedPdfPage } from "./pdfExtraction";
import { previewFromSheets, type PreviewRow, type StatementPreview } from "./workbook";

export function parseCaliforniaChoiceMonth(value: string | null | undefined) {
  const fromFlexible = parseFlexibleMonth(value);
  if (fromFlexible) return fromFlexible;
  const trimmed = value?.trim() ?? "";
  const mmYy = trimmed.match(/^(0?[1-9]|1[0-2])[/-](\d{2}|\d{4})$/);
  if (!mmYy) return null;
  const month = mmYy[1]!.padStart(2, "0");
  const year = mmYy[2]!.length === 2 ? `20${mmYy[2]}` : mmYy[2]!;
  return `${year}-${month}`;
}

export const CALIFORNIA_CHOICE_HEADERS = {
  groupNumber: "Group Number",
  groupName: "Company Name",
  paidMonth: "Paid Month",
  product: "Product",
  premium: "Paid Premium",
  rate: "Carrier Commission %",
  commission: "Commission Amount",
} as const;

const ignoredLine = /^(page\s+\d+|subtotal|total|grand total|commission statement|california\s*choice|adjustment|adj(\.|ustment)?\s*code)/i;
const rateToken = /^\d{1,2}(?:\.\d{1,2})%?$/;

export function looksLikeCaliforniaChoice(pages: ExtractedPdfPage[]) {
  const text = pages.map((page) => [page.text, ...(page.lines ?? [])].join("\n")).join("\n");
  if (/california\s*choice/i.test(text)) return true;
  const lines = pages.flatMap((page) => (page.lines.length > 0 ? page.lines : page.text.split(/\r?\n/))).map((line) => line.trim()).filter(Boolean);
  let standaloneNumbers = 0;
  let monthProductRows = 0;
  for (const line of lines) {
    if (/^\d{4,8}$/.test(line)) standaloneNumbers += 1;
    if (parseCaliforniaChoiceMonth(line.split(/\s{2,}|\s/)[0] ?? "") && isCoverageLabel(line.split(/\s{2,}|\s/).find((cell) => isCoverageLabel(cell)) ?? "")) {
      monthProductRows += 1;
    }
  }
  return standaloneNumbers >= 2 && monthProductRows >= 2 && !/choice\s*builder/i.test(text);
}

function isMoney(value: string) {
  return moneyToken.test(value.replace(/\s/g, ""));
}

function isGroupNumber(value: string) {
  return /^\d{4,8}$/.test(value.trim());
}

function isCompanyName(value: string) {
  const text = value.trim();
  if (!text || isMoney(text) || isGroupNumber(text) || parseCaliforniaChoiceMonth(text) != null || isCoverageLabel(text) || rateToken.test(text)) {
    return false;
  }
  if (ignoredLine.test(text)) return false;
  return /[A-Za-z]/.test(text);
}

function tokensFromLine(line: string) {
  if (line.includes("\t")) return line.split("\t").map((cell) => cell.trim()).filter(Boolean);
  const wide = line.split(/\s{2,}|\s\|\s/).map((cell) => cell.trim()).filter(Boolean);
  if (wide.length >= 2) return wide;
  const trimmed = line.trim();
  if (parseCaliforniaChoiceMonth(trimmed) || isGroupNumber(trimmed) || isCoverageLabel(trimmed) || isMoney(trimmed)) {
    return [trimmed];
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.some((part) => isMoney(part) || parseCaliforniaChoiceMonth(part) || isCoverageLabel(part) || isGroupNumber(part))) {
    return parts;
  }
  return [trimmed];
}

export type CaliforniaChoiceRecord = {
  groupNumber: string;
  groupName: string;
  paidMonth: string;
  product: string;
  premium: string | null;
  rate: string | null;
  commission: string;
};

export function parseCaliforniaChoiceLines(lines: string[]): CaliforniaChoiceRecord[] {
  const usable = lines.map((line) => line.trim()).filter((line) => line && !ignoredLine.test(line) && !/^page\s+\d+(\s+of\s+\d+)?$/i.test(line));
  const records: CaliforniaChoiceRecord[] = [];
  let groupNumber = "";
  let groupName = "";
  let index = 0;

  const take = () => usable[index++];
  const peek = () => usable[index];

  while (index < usable.length) {
    const line = take();
    if (!line) break;
    const tokens = tokensFromLine(line);

    if (tokens.length === 1 && isGroupNumber(tokens[0]!)) {
      groupNumber = tokens[0]!;
      const next = peek();
      if (next && tokensFromLine(next).length === 1 && isCompanyName(next)) {
        groupName = take() ?? groupName;
      }
      continue;
    }

    if (tokens.length === 1 && isCompanyName(tokens[0]!) && groupNumber) {
      groupName = tokens[0]!;
      continue;
    }

    if (tokens.length >= 3 && isGroupNumber(tokens[0]!) && isCompanyName(tokens[1]!)) {
      groupNumber = tokens[0]!;
      groupName = tokens[1]!;
      const rest = tokens.slice(2);
      const parsed = parseCommissionTokens(rest);
      if (parsed && groupNumber && groupName) {
        records.push({ groupNumber, groupName, ...parsed });
      }
      continue;
    }

    if (tokens.length === 1 && parseCaliforniaChoiceMonth(tokens[0]!) != null) {
      const month = tokens[0]!;
      const collected: string[] = [month];
      while (index < usable.length && collected.length < 5) {
        const next = peek();
        if (!next) break;
        const nextTokens = tokensFromLine(next);
        if (nextTokens.length !== 1) break;
        const value = nextTokens[0]!;
        if (isGroupNumber(value) || (isCompanyName(value) && !isCoverageLabel(value))) break;
        collected.push(take()!);
      }
      const parsed = parseCommissionTokens(collected);
      if (parsed && groupNumber && groupName && !isCoverageLabel(groupName)) {
        records.push({ groupNumber, groupName, ...parsed });
      }
      continue;
    }

    const parsed = parseCommissionTokens(tokens);
    if (parsed && groupNumber && groupName && !isCoverageLabel(groupName)) {
      records.push({ groupNumber, groupName, ...parsed });
    }
  }

  return records;
}

function parseCommissionTokens(tokens: string[]) {
  const month = tokens.find((token) => parseCaliforniaChoiceMonth(token) != null);
  const product = tokens.find((token) => isCoverageLabel(token));
  const money = tokens.filter((token) => isMoney(token));
  const rate = tokens.find((token) => rateToken.test(token) && !isMoney(token));
  const commission = money[money.length - 1];
  const premium = money.length > 1 ? money[0]! : null;
  if (!month || !product || !commission) return null;
  if (isCoverageLabel(month) || isGroupNumber(product)) return null;
  return {
    paidMonth: parseCaliforniaChoiceMonth(month) ?? month,
    product,
    premium,
    rate: rate ?? null,
    commission,
  };
}

export function interpretCaliforniaChoiceStatement(
  pages: ExtractedPdfPage[],
  groups: GroupCandidate[] = [],
): { preview: StatementPreview; mapping: ColumnMapping; inferred: true } | null {
  if (!looksLikeCaliforniaChoice(pages)) return null;
  const records: Array<CaliforniaChoiceRecord & { pageNumber: number; lineNumber: number }> = [];
  let carriedNumber = "";
  let carriedName = "";
  for (const page of pages) {
    const lines = page.lines.length > 0 ? page.lines : page.text.split(/\r?\n/);
    const parsed = parseCaliforniaChoiceLines([
      ...(carriedNumber ? [carriedNumber] : []),
      ...(carriedName ? [carriedName] : []),
      ...lines,
    ]);
    parsed.forEach((record, index) => {
      records.push({
        ...record,
        pageNumber: page.pageNumber,
        lineNumber: index + 1,
      });
      carriedNumber = record.groupNumber;
      carriedName = record.groupName;
    });
  }
  if (records.length === 0) return null;
  const headers = [
    CALIFORNIA_CHOICE_HEADERS.groupNumber,
    CALIFORNIA_CHOICE_HEADERS.groupName,
    CALIFORNIA_CHOICE_HEADERS.paidMonth,
    CALIFORNIA_CHOICE_HEADERS.product,
    CALIFORNIA_CHOICE_HEADERS.premium,
    CALIFORNIA_CHOICE_HEADERS.rate,
    CALIFORNIA_CHOICE_HEADERS.commission,
  ];
  const rows: PreviewRow[] = records.map((record, index) => {
    const values = {
      [CALIFORNIA_CHOICE_HEADERS.groupNumber]: record.groupNumber,
      [CALIFORNIA_CHOICE_HEADERS.groupName]: record.groupName,
      [CALIFORNIA_CHOICE_HEADERS.paidMonth]: record.paidMonth,
      [CALIFORNIA_CHOICE_HEADERS.product]: record.product,
      [CALIFORNIA_CHOICE_HEADERS.premium]: record.premium ?? "",
      [CALIFORNIA_CHOICE_HEADERS.rate]: record.rate ?? "",
      [CALIFORNIA_CHOICE_HEADERS.commission]: record.commission,
    };
    return {
      rowNumber: index + 1,
      values,
      premiumMonth: record.paidMonth,
      group: matchCarrierGroupNumberFirst(groups, record.groupName, record.groupNumber),
      pageNumber: record.pageNumber,
      sourceIdentity: `pdf:page:${record.pageNumber}:row:${record.lineNumber}`,
    };
  });
  const preview = previewFromSheets([{
    name: "Page 1",
    headerRowNumber: 1,
    rowCount: rows.length,
    headers,
    groupNameHeader: CALIFORNIA_CHOICE_HEADERS.groupName,
    groupNumberHeader: CALIFORNIA_CHOICE_HEADERS.groupNumber,
    premiumMonthHeader: CALIFORNIA_CHOICE_HEADERS.paidMonth,
    rows,
  }]);
  return {
    preview: {
      ...preview,
      pdf: {
        classification: "readable",
        pageCount: pages.length,
        groupMatchStrategy: "carrier_group_number",
      },
    },
    mapping: {
      groupName: CALIFORNIA_CHOICE_HEADERS.groupName,
      groupNumber: CALIFORNIA_CHOICE_HEADERS.groupNumber,
      lineOfBusiness: CALIFORNIA_CHOICE_HEADERS.product,
      premium: CALIFORNIA_CHOICE_HEADERS.premium,
      grossCommission: CALIFORNIA_CHOICE_HEADERS.commission,
      premiumMonth: CALIFORNIA_CHOICE_HEADERS.paidMonth,
      compensationPercent: CALIFORNIA_CHOICE_HEADERS.rate,
    },
    inferred: true,
  };
}
