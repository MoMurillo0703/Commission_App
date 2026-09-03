import { matchNamedRecord, type NamedRecord, type NameMatch } from "./nameMatch";

export type NamedImportAction = "create" | "match";

export type UnmatchedNamedImport = {
  key: string;
  sourceName: string;
  rowCount: number;
};

export type NamedImportDecision = {
  key: string;
  action: NamedImportAction;
  existingId?: number | null;
};

export type NamedImportResolution = {
  key: string;
  entityId: number;
  sourceName: string;
  action?: NamedImportAction;
};

export function normalizeNamedImportText(value: string | null | undefined) {
  const collapsed = value?.trim().replace(/\s+/g, " ");
  return collapsed ? collapsed.toLowerCase() : null;
}

export function displayNamedImportText(value: string | null | undefined) {
  const collapsed = value?.trim().replace(/\s+/g, " ");
  return collapsed || null;
}

export function unmatchedNamedIdentity(sourceName: string | null | undefined) {
  const name = normalizeNamedImportText(sourceName);
  return name ? `name:${name}` : "missing";
}

export function applyNamedResolutions(
  match: NameMatch,
  resolutions: NamedImportResolution[] | undefined,
  records: NamedRecord[],
): NameMatch {
  const key = unmatchedNamedIdentity(match.source);
  const resolution = resolutions?.find((item) => item.key === key);
  if (!resolution) return match;
  const record = records.find((item) => item.id === resolution.entityId);
  if (!record) return match;
  return {
    status: "matched",
    id: record.id,
    name: record.name,
    source: match.source,
  };
}

export function resolveNamedImport(
  records: NamedRecord[],
  source: string | null | undefined,
  resolutions?: NamedImportResolution[],
) {
  return applyNamedResolutions(matchNamedRecord(records, source), resolutions, records);
}

export function collectUnmatchedNamedImports(
  rows: Array<{ exceptions: string[]; importedName: string | null | undefined }>,
  prefixes: string[],
): UnmatchedNamedImport[] {
  const byKey = new Map<string, UnmatchedNamedImport>();
  for (const row of rows) {
    if (!row.exceptions.some((item) => prefixes.some((prefix) => item.startsWith(prefix)))) continue;
    const sourceName = displayNamedImportText(row.importedName);
    const key = unmatchedNamedIdentity(sourceName);
    if (key === "missing" || !sourceName) continue;
    const existing = byKey.get(key);
    if (existing) {
      existing.rowCount += 1;
      continue;
    }
    byKey.set(key, { key, sourceName, rowCount: 1 });
  }
  return [...byKey.values()].sort((left, right) => left.sourceName.localeCompare(right.sourceName));
}

export const unmatchedLinePrefixes = ["Unmatched line of business:", "Line of business matches more than one"];
export const unmatchedAgentPrefixes = ["Unmatched agent:", "Agent name matches more than one"];

export function collectUnmatchedImportLines(rows: Array<{ exceptions: string[]; importedName: string | null | undefined }>) {
  return collectUnmatchedNamedImports(rows, unmatchedLinePrefixes);
}

export function collectUnmatchedImportAgents(rows: Array<{ exceptions: string[]; importedName: string | null | undefined }>) {
  return collectUnmatchedNamedImports(rows, unmatchedAgentPrefixes);
}

export function findNormalizedNamedRecord(records: NamedRecord[], sourceName: string | null | undefined) {
  const match = matchNamedRecord(records, sourceName);
  if (match.status !== "matched" || match.id == null) return null;
  return records.find((record) => record.id === match.id) ?? null;
}
