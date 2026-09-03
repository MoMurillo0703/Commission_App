import { detectGroupHeaders } from "./groupMatch";

export const mappingFields = [
  "groupName",
  "groupNumber",
  "carrier",
  "lineOfBusiness",
  "agent",
  "premium",
  "grossCommission",
  "compensationPercent",
  "premiumMonth",
  "notes",
] as const;

export type MappingField = (typeof mappingFields)[number];
export type ColumnMapping = Partial<Record<MappingField, string | null>>;

const headerPatterns: Record<Exclude<MappingField, "groupName" | "groupNumber" | "premiumMonth">, RegExp> = {
  carrier: /^(carrier|company|insurer)$/i,
  lineOfBusiness: /^(line of business|lob|product( line| type)?)$/i,
  agent: /^(agent|producer( name)?|broker)$/i,
  premium: /^(premium|billed premium|premium received)$/i,
  grossCommission: /^(gross |current )?commission|comm\.?$/i,
  compensationPercent: /^(split|agent %|agent split|compensation( %| percent)?)$/i,
  notes: /^(notes?|comments?)$/i,
};

export const mappingFieldLabels: Record<MappingField, string> = {
  groupName: "Group name",
  groupNumber: "Group number",
  carrier: "Carrier",
  lineOfBusiness: "Line of business",
  agent: "Agent",
  premium: "Premium",
  grossCommission: "Gross commission",
  compensationPercent: "Agent split %",
  premiumMonth: "Premium / coverage month",
  notes: "Notes",
};

function findHeader(headers: string[], pattern: RegExp) {
  return headers.find((header) => pattern.test(header.trim())) ?? null;
}

export function suggestColumnMapping(headers: string[]): ColumnMapping {
  const detected = detectGroupHeaders(headers);
  return {
    groupName: detected.groupNameHeader,
    groupNumber: detected.groupNumberHeader,
    premiumMonth: detected.premiumMonthHeader,
    carrier: findHeader(headers, headerPatterns.carrier),
    lineOfBusiness: findHeader(headers, headerPatterns.lineOfBusiness),
    agent: findHeader(headers, headerPatterns.agent),
    premium: findHeader(headers, headerPatterns.premium),
    grossCommission: findHeader(headers, headerPatterns.grossCommission),
    compensationPercent: findHeader(headers, headerPatterns.compensationPercent),
    notes: findHeader(headers, headerPatterns.notes),
  };
}

export function mappingValue(values: Record<string, string>, header: string | null | undefined) {
  if (!header) return null;
  const value = values[header]?.trim();
  return value ? value : null;
}

export function collectPreviewHeaders(sheets: { headers: string[] }[]) {
  return [...new Set(sheets.flatMap((sheet) => sheet.headers))];
}
