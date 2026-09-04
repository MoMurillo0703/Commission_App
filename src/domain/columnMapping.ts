import { detectGroupHeaders } from "./groupMatch";

export const mappingFields = [
  "groupName",
  "groupNumber",
  "carrier",
  "lineOfBusiness",
  "premium",
  "grossCommission",
  "premiumMonth",
  "notes",
] as const;

export const statementIntakeHiddenFields = ["agent", "compensationPercent"] as const;

export type MappingField = (typeof mappingFields)[number];
export type ColumnMapping = Partial<Record<MappingField, string | null>> & {
  /** Spreadsheet-only leftover. PDF intake does not map Agent or splits. */
  agent?: string | null;
  /** Ignored leftover from older statement mappings. Compensation comes from agreements. */
  compensationPercent?: string | null;
};

const headerPatterns: Record<Exclude<MappingField, "groupName" | "groupNumber" | "premiumMonth">, RegExp> = {
  carrier: /^(carrier|company|insurer)$/i,
  lineOfBusiness: /^(line of business|lob|product( line| type| code)?|coverage( code| type)?|plan( type| code)?|benefit)$/i,
  premium: /^(premium|billed premium|premium received|paid)$/i,
  grossCommission: /^(gross |current )?commission|comm\.?$|^fee$/i,
  notes: /^(notes?|comments?)$/i,
};
const agentHeader = /^(agent|producer( name)?|broker)$/i;

export const mappingFieldLabels: Record<MappingField, string> = {
  groupName: "Group name",
  groupNumber: "Group number",
  carrier: "Carrier",
  lineOfBusiness: "Line of business",
  premium: "Premium",
  grossCommission: "Gross commission",
  premiumMonth: "Premium / coverage month",
  notes: "Notes",
};

function findHeader(headers: string[], pattern: RegExp) {
  return headers.find((header) => pattern.test(header.trim())) ?? null;
}

export function normalizeColumnMapping(mapping: ColumnMapping): ColumnMapping {
  const { compensationPercent: _ignored, ...rest } = mapping;
  return rest;
}

/** Statement intake never maps compensation. PDF interpretation also drops leftover Agent columns. */
export function omitStatementCompensationMapping(mapping: ColumnMapping): ColumnMapping {
  const { agent: _agent, compensationPercent: _split, ...rest } = normalizeColumnMapping(mapping);
  return rest;
}

export function suggestColumnMapping(headers: string[]): ColumnMapping {
  const detected = detectGroupHeaders(headers);
  return normalizeColumnMapping({
    groupName: detected.groupNameHeader,
    groupNumber: detected.groupNumberHeader,
    premiumMonth: detected.premiumMonthHeader,
    carrier: findHeader(headers, headerPatterns.carrier),
    lineOfBusiness: findHeader(headers, headerPatterns.lineOfBusiness),
    agent: findHeader(headers, agentHeader),
    premium: findHeader(headers, headerPatterns.premium),
    grossCommission: findHeader(headers, headerPatterns.grossCommission),
    notes: findHeader(headers, headerPatterns.notes),
  });
}

export function mappingValue(values: Record<string, string>, header: string | null | undefined) {
  if (!header) return null;
  const value = values[header]?.trim();
  return value ? value : null;
}

export function collectPreviewHeaders(sheets: { headers: string[] }[]) {
  return [...new Set(sheets.flatMap((sheet) => sheet.headers))];
}

export function mappingLooksAutomatic(mapping: ColumnMapping) {
  return Boolean((mapping.groupName || mapping.groupNumber) && mapping.grossCommission);
}
