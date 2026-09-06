import { matchCarrierGroupIdentity, type CarrierGroupIdentity } from "./carrierGroupIdentity";
import type { ColumnMapping } from "./columnMapping";
import { isCoverageLabel } from "./coverageLabels";
import { parseCaliforniaChoiceMonth } from "./dates";
import type { GroupCandidate } from "./groupMatch";
import { isCurrencySymbol } from "./lobCandidates";
import { moneyToken, type ExtractedPdfPage } from "./pdfExtraction";
import { previewFromSheets, type PreviewRow, type StatementPreview } from "./workbook";

export { parseCaliforniaChoiceMonth };

export function isCaliforniaChoiceSource(value: string | null | undefined) {
  return /cal(?:ifornia)?\s*choice/i.test(value ?? "");
}

export const CALIFORNIA_CHOICE_HEADERS = {
  groupNumber: "Group Number",
  groupName: "Company Name",
  paidMonth: "Paid Month",
  product: "Product",
  premium: "Paid Premium",
  rate: "Carrier Commission %",
  commission: "Commission Amount",
  adjustmentCode: "ADJ CD",
  sourceContext: "Source context",
} as const;

const ignoredLine = /^(page\s+\d+|subtotal|total|grand total|commission statement|california\s*choice|cal\s*choice|adjustment|adj(\.|ustment)?\s*code)/i;
const rateToken = /^\d{1,2}(?:\.\d{1,2})%?$/;

export function looksLikeCaliforniaChoice(pages: ExtractedPdfPage[], hint?: string | null) {
  const text = [hint ?? "", ...pages.map((page) => [page.text, ...(page.lines ?? [])].join("\n"))].join("\n");
  if (/choice\s*builder/i.test(text) && !isCaliforniaChoiceSource(text)) return false;
  if (isCaliforniaChoiceSource(text)) return true;
  const lines = pages.flatMap((page) => (page.lines.length > 0 ? page.lines : page.text.split(/\r?\n/))).map((line) => line.trim()).filter(Boolean);
  let standaloneNumbers = 0;
  let monthProductRows = 0;
  for (const line of lines) {
    if (/^\d{4,8}$/.test(line)) standaloneNumbers += 1;
    if (parseCaliforniaChoiceMonth(line.split(/\s{2,}|\s/)[0] ?? "") && isCoverageLabel(line.split(/\s{2,}|\s/).find((cell) => isCoverageLabel(cell)) ?? "")) {
      monthProductRows += 1;
    }
  }
  return standaloneNumbers >= 2 && monthProductRows >= 2;
}

function isMoney(value: string) {
  return moneyToken.test(value.replace(/\s/g, ""));
}

function isGroupNumber(value: string) {
  return /^\d{4,8}$/.test(value.trim());
}

function isCompanyName(value: string) {
  const text = value.trim();
  if (!text || isMoney(text) || isCurrencySymbol(text) || isGroupNumber(text) || parseCaliforniaChoiceMonth(text) != null || isCoverageLabel(text) || rateToken.test(text)) {
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
  if (parseCaliforniaChoiceMonth(trimmed) || isGroupNumber(trimmed) || isCoverageLabel(trimmed) || isMoney(trimmed) || isCurrencySymbol(trimmed)) {
    return [trimmed];
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.some((part) => isMoney(part) || isCurrencySymbol(part) || parseCaliforniaChoiceMonth(part) || isCoverageLabel(part) || isGroupNumber(part))) {
    return parts;
  }
  return [trimmed];
}

export type CaliforniaChoiceRecord = {
  groupNumber: string;
  groupName: string;
  paidMonthSource: string;
  product: string;
  premium: string | null;
  rate: string | null;
  commission: string;
  adjustmentCode: string | null;
};

export type CaliforniaChoiceMatchContext = {
  carrierId?: number | null;
  identities?: CarrierGroupIdentity[];
  sourceHint?: string | null;
};

function isAdjustmentCode(value: string) {
  const text = value.trim();
  if (!text) return false;
  if (isMoney(text) || isCurrencySymbol(text) || isGroupNumber(text) || parseCaliforniaChoiceMonth(text) != null || isCoverageLabel(text) || rateToken.test(text)) {
    return false;
  }
  if (ignoredLine.test(text)) return false;
  return /^[A-Za-z0-9._/-]{1,12}$/.test(text);
}

export function californiaChoiceSourceContext(record: Pick<CaliforniaChoiceRecord, "paidMonthSource" | "adjustmentCode">) {
  return [
    record.paidMonthSource ? `Carrier paid month: ${record.paidMonthSource}` : null,
    record.adjustmentCode ? `ADJ CD: ${record.adjustmentCode}` : null,
  ].filter(Boolean).join(" · ");
}

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

    const monthIndex = isGroupNumber(tokens[0] ?? "")
      ? tokens.findIndex((token, tokenIndex) => tokenIndex >= 1 && parseCaliforniaChoiceMonth(token) != null)
      : -1;
    if (tokens.length >= 3 && isGroupNumber(tokens[0]!) && monthIndex > 1) {
      const name = tokens.slice(1, monthIndex).join(" ").trim();
      if (name && !isCoverageLabel(name)) {
        groupNumber = tokens[0]!;
        groupName = name;
      }
      const parsed = parseCommissionTokens(tokens.slice(monthIndex));
      if (parsed && groupNumber && groupName && !isCoverageLabel(groupName)) {
        records.push({ groupNumber, groupName, ...parsed });
      }
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
      while (index < usable.length) {
        const next = peek();
        if (!next) break;
        const nextTokens = tokensFromLine(next);
        if (nextTokens.length !== 1) break;
        const value = nextTokens[0]!;
        if (isGroupNumber(value)) break;
        if (isCompanyName(value) && !isCoverageLabel(value) && !isCurrencySymbol(value)) break;
        if (parseCaliforniaChoiceMonth(value) != null && collected.some((token) => isProductCandidate(token))) break;
        collected.push(take()!);
        if (parseCommissionTokens(collected) && !shouldKeepCollectingCommission(peek())) break;
      }
      const parsed = parseCommissionTokens(collected);
      if (parsed && !parsed.adjustmentCode) {
        const next = peek();
        const nextTokens = next ? tokensFromLine(next) : [];
        if (nextTokens.length === 1 && isAdjustmentCode(nextTokens[0]!)) {
          parsed.adjustmentCode = take() ?? null;
        }
      }
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

function isProductCandidate(value: string) {
  const text = value.trim();
  if (!text || isCurrencySymbol(text) || isMoney(text) || isGroupNumber(text)) return false;
  if (parseCaliforniaChoiceMonth(text) != null) return false;
  if (rateToken.test(text) && !isCoverageLabel(text)) return false;
  if (isImpossibleLobName(text) && !isCoverageLabel(text)) return false;
  return /[A-Za-z]/.test(text);
}

function isImpossibleLobName(value: string) {
  return /^(page(\s+\d+.*)?|subtotal|sub-total|total|grand total|california\s*choice|cal(\s*ifornia)?\s*choice)$/i.test(value.trim());
}

function shouldKeepCollectingCommission(nextLine: string | undefined) {
  if (!nextLine) return false;
  const nextTokens = tokensFromLine(nextLine);
  if (nextTokens.length !== 1) return false;
  const value = nextTokens[0]!;
  return isCurrencySymbol(value) || isMoney(value) || rateToken.test(value) || isAdjustmentCode(value);
}

function parseCommissionTokens(tokens: string[]) {
  const usable = tokens.filter((token) => !isCurrencySymbol(token));
  const monthIndex = usable.findIndex((token) => parseCaliforniaChoiceMonth(token) != null);
  const month = monthIndex >= 0 ? usable[monthIndex] : undefined;
  const afterMonth = monthIndex >= 0 ? usable.slice(monthIndex + 1) : usable;
  const product = afterMonth.find((token) => isProductCandidate(token))
    ?? afterMonth.find((token) => isCoverageLabel(token));
  const money = afterMonth.filter((token) => isMoney(token));
  const rate = afterMonth.find((token) => rateToken.test(token) && !isMoney(token) && token !== product);
  const commission = money[money.length - 1];
  const premium = money.length > 1 ? money[0]! : null;
  if (!month || !commission) return null;
  if (product && (isCoverageLabel(month) || isGroupNumber(product))) return null;
  const consumed = new Set([month, product, rate, ...money].filter(Boolean));
  const adjustmentCode = usable.find((token) => !consumed.has(token) && isAdjustmentCode(token)) ?? null;
  return {
    paidMonthSource: month,
    product: product ?? "",
    premium,
    rate: rate ?? null,
    commission,
    adjustmentCode,
  };
}

export function interpretCaliforniaChoiceStatement(
  pages: ExtractedPdfPage[],
  groups: GroupCandidate[] = [],
  context: CaliforniaChoiceMatchContext = {},
): { preview: StatementPreview; mapping: ColumnMapping; inferred: true } | null {
  if (!looksLikeCaliforniaChoice(pages, context.sourceHint)) return null;
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
    CALIFORNIA_CHOICE_HEADERS.adjustmentCode,
    CALIFORNIA_CHOICE_HEADERS.sourceContext,
  ];
  const rows: PreviewRow[] = records.map((record, index) => {
    const values = {
      [CALIFORNIA_CHOICE_HEADERS.groupNumber]: record.groupNumber,
      [CALIFORNIA_CHOICE_HEADERS.groupName]: record.groupName,
      [CALIFORNIA_CHOICE_HEADERS.paidMonth]: record.paidMonthSource,
      [CALIFORNIA_CHOICE_HEADERS.product]: record.product,
      [CALIFORNIA_CHOICE_HEADERS.premium]: record.premium ?? "",
      [CALIFORNIA_CHOICE_HEADERS.rate]: record.rate ?? "",
      [CALIFORNIA_CHOICE_HEADERS.commission]: record.commission,
      [CALIFORNIA_CHOICE_HEADERS.adjustmentCode]: record.adjustmentCode ?? "",
      [CALIFORNIA_CHOICE_HEADERS.sourceContext]: californiaChoiceSourceContext(record),
    };
    return {
      rowNumber: index + 1,
      values,
      premiumMonth: null,
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
    groupNameHeader: CALIFORNIA_CHOICE_HEADERS.groupName,
    groupNumberHeader: CALIFORNIA_CHOICE_HEADERS.groupNumber,
    premiumMonthHeader: null,
    rows,
  }]);
  return {
    preview: {
      ...preview,
      pdf: {
        classification: "readable",
        pageCount: pages.length,
        groupMatchStrategy: "carrier_group_identity",
      },
    },
    mapping: {
      groupName: CALIFORNIA_CHOICE_HEADERS.groupName,
      groupNumber: CALIFORNIA_CHOICE_HEADERS.groupNumber,
      lineOfBusiness: CALIFORNIA_CHOICE_HEADERS.product,
      premium: CALIFORNIA_CHOICE_HEADERS.premium,
      grossCommission: CALIFORNIA_CHOICE_HEADERS.commission,
      notes: CALIFORNIA_CHOICE_HEADERS.sourceContext,
    },
    inferred: true,
  };
}
