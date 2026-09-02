export type GroupMatchStatus = "matched" | "new_group" | "missing";

export type GroupCandidate = {
  id: number;
  name: string;
  groupNumber: string | null;
  primaryAgentId?: number | null;
  defaultCompensationBps?: number | null;
};

export type GroupMatch = {
  status: GroupMatchStatus;
  groupId: number | null;
  groupName: string | null;
  sourceName: string | null;
  sourceNumber: string | null;
};

const groupNameHeader = /^(group(\s*name)?|client(\s*name)?|account(\s*name)?)$/i;
const groupNumberHeader = /^(group\s*(number|no\.?|#|id)|account\s*(number|no\.?|#|id)|client\s*(number|no\.?|#|id)|group\s*#)$/i;
const premiumMonthHeader = /^(premium|coverage|policy)\s*month$|^(coverage|benefit)\s*period$/i;

function normalize(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

export function detectGroupHeaders(headers: string[]) {
  return {
    groupNameHeader: headers.find((header) => groupNameHeader.test(header.trim())) ?? null,
    groupNumberHeader: headers.find((header) => groupNumberHeader.test(header.trim())) ?? null,
    premiumMonthHeader: headers.find((header) => premiumMonthHeader.test(header.trim())) ?? null,
  };
}

export function matchImportedGroup(
  groups: GroupCandidate[],
  sourceName: string | null | undefined,
  sourceNumber: string | null | undefined,
): GroupMatch {
  const name = sourceName?.trim() || null;
  const number = sourceNumber?.trim() || null;
  if (!name && !number) {
    return { status: "missing", groupId: null, groupName: null, sourceName: name, sourceNumber: number };
  }

  const normalizedNumber = normalize(number);
  const byNumber = normalizedNumber
    ? groups.find((group) => normalize(group.groupNumber) === normalizedNumber)
    : undefined;
  if (byNumber) {
    return { status: "matched", groupId: byNumber.id, groupName: byNumber.name, sourceName: name, sourceNumber: number };
  }

  const normalizedName = normalize(name);
  const byName = normalizedName
    ? groups.find((group) => normalize(group.name) === normalizedName)
    : undefined;
  if (byName) {
    return { status: "matched", groupId: byName.id, groupName: byName.name, sourceName: name, sourceNumber: number };
  }

  return { status: "new_group", groupId: null, groupName: null, sourceName: name, sourceNumber: number };
}

export function unmatchedGroupKey(match: GroupMatch) {
  return `${match.sourceNumber ?? ""}::${match.sourceName ?? ""}`.toLowerCase();
}
