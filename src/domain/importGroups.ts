import { displayGroupText, unmatchedGroupIdentity, type GroupCandidate } from "./groupMatch";
import type { ValidatedImportRow } from "./importRows";

export type GroupImportAction = "create" | "match";

export type UnmatchedImportGroup = {
  key: string;
  sourceName: string | null;
  sourceNumber: string | null;
  rowCount: number;
};

export type GroupImportDecision = {
  key: string;
  action: GroupImportAction;
  existingGroupId?: number | null;
};

export function collectUnmatchedImportGroups(rows: Array<Pick<ValidatedImportRow, "exceptions" | "importedGroupName" | "importedGroupNumber">>): UnmatchedImportGroup[] {
  const byKey = new Map<string, UnmatchedImportGroup>();
  for (const row of rows) {
    if (!row.exceptions.some((item) => item.startsWith("Unmatched group:") || item.startsWith("Ambiguous group:"))) continue;
    const sourceName = displayGroupText(row.importedGroupName);
    const sourceNumber = displayGroupText(row.importedGroupNumber);
    const key = unmatchedGroupIdentity(sourceName, sourceNumber);
    if (key === "missing") continue;
    const existing = byKey.get(key);
    if (existing) {
      existing.rowCount += 1;
      if (!existing.sourceNumber && sourceNumber) existing.sourceNumber = sourceNumber;
      continue;
    }
    byKey.set(key, { key, sourceName, sourceNumber, rowCount: 1 });
  }
  return [...byKey.values()].sort((left, right) => (left.sourceName ?? left.sourceNumber ?? "").localeCompare(right.sourceName ?? right.sourceNumber ?? ""));
}

export function proposedGroupName(group: Pick<UnmatchedImportGroup, "sourceName" | "sourceNumber">) {
  return displayGroupText(group.sourceName) ?? displayGroupText(group.sourceNumber);
}

export function groupNumberConflict(existing: GroupCandidate, importedNumber: string | null) {
  const current = displayGroupText(existing.groupNumber);
  const incoming = displayGroupText(importedNumber);
  return Boolean(current && incoming && current.toLowerCase() !== incoming.toLowerCase());
}
