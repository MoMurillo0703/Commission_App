export type GroupMatchStatus = "matched" | "new_group" | "missing" | "ambiguous";

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

const groupNameHeader = /^(group(\s*name)?|name\s*\/\s*group name|company(\s*name)?|client(\s*name)?|account(\s*name)?|member|subscriber|employer)$/i;
const groupNumberHeader = /^(group\s*(number|no\.?|#|id)|account\s*(number|no\.?|#|id)|client\s*(number|no\.?|#|id)|policy\s*(number|no\.?|#|id)|group\s*#)$/i;
const premiumMonthHeader = /^(premium|coverage|policy|paid)\s*month$|^(coverage|benefit)\s*period$|^due date$/i;

export function normalizeGroupText(value: string | null | undefined) {
  const collapsed = value?.trim().replace(/\s+/g, " ");
  return collapsed ? collapsed.toLowerCase() : null;
}

export function displayGroupText(value: string | null | undefined) {
  const collapsed = value?.trim().replace(/\s+/g, " ");
  return collapsed || null;
}

export function unmatchedGroupIdentity(sourceName: string | null | undefined, sourceNumber: string | null | undefined) {
  const name = normalizeGroupText(sourceName);
  const number = normalizeGroupText(sourceNumber);
  if (name && number) return `name:${name}|number:${number}`;
  if (name) return `name:${name}`;
  if (number) return `number:${number}`;
  return "missing";
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
  const name = displayGroupText(sourceName);
  const number = displayGroupText(sourceNumber);
  if (!name && !number) {
    return { status: "missing", groupId: null, groupName: null, sourceName: name, sourceNumber: number };
  }

  const normalizedName = normalizeGroupText(name);
  const normalizedNumber = normalizeGroupText(number);
  const nameMatches = normalizedName
    ? groups.filter((group) => normalizeGroupText(group.name) === normalizedName)
    : [];
  const numberMatches = normalizedNumber
    ? groups.filter((group) => normalizeGroupText(group.groupNumber) === normalizedNumber)
    : [];

  if (normalizedName && normalizedNumber) {
    const exact = nameMatches.filter((group) => numberMatches.some((candidate) => candidate.id === group.id));
    if (exact.length === 1 && numberMatches.length === 1) {
      return { status: "matched", groupId: exact[0].id, groupName: exact[0].name, sourceName: name, sourceNumber: number };
    }
    if (nameMatches.length > 0 || numberMatches.length > 0) {
      return { status: "ambiguous", groupId: null, groupName: null, sourceName: name, sourceNumber: number };
    }
  } else if (normalizedName) {
    if (nameMatches.length === 1) {
      return { status: "matched", groupId: nameMatches[0].id, groupName: nameMatches[0].name, sourceName: name, sourceNumber: number };
    }
    if (nameMatches.length > 1) {
      return { status: "ambiguous", groupId: null, groupName: null, sourceName: name, sourceNumber: number };
    }
  } else if (normalizedNumber) {
    if (numberMatches.length === 1) {
      return { status: "matched", groupId: numberMatches[0].id, groupName: numberMatches[0].name, sourceName: name, sourceNumber: number };
    }
    if (numberMatches.length > 1) {
      return { status: "ambiguous", groupId: null, groupName: null, sourceName: name, sourceNumber: number };
    }
  }

  return { status: "new_group", groupId: null, groupName: null, sourceName: name, sourceNumber: number };
}

export function unmatchedGroupKey(match: GroupMatch) {
  return unmatchedGroupIdentity(match.sourceName, match.sourceNumber);
}

export function findNormalizedGroup(
  groups: GroupCandidate[],
  sourceName: string | null | undefined,
  sourceNumber: string | null | undefined,
) {
  const match = matchImportedGroup(groups, sourceName, sourceNumber);
  if (match.status !== "matched" || match.groupId == null) return null;
  return groups.find((group) => group.id === match.groupId) ?? null;
}

export type GroupImportResolution = {
  key: string;
  groupId: number;
  sourceName: string | null;
  sourceNumber: string | null;
  action?: "create" | "match";
};

export function applyGroupResolutions(
  match: GroupMatch,
  resolutions: GroupImportResolution[] | undefined,
  groups: GroupCandidate[],
): GroupMatch {
  const key = unmatchedGroupIdentity(match.sourceName, match.sourceNumber);
  const resolution = resolutions?.find((item) => item.key === key);
  if (resolution) {
    const group = groups.find((item) => item.id === resolution.groupId);
    if (group) {
      return {
        status: "matched",
        groupId: group.id,
        groupName: group.name,
        sourceName: match.sourceName,
        sourceNumber: match.sourceNumber,
      };
    }
  }
  return match;
}
