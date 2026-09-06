export type GroupMatchStatus = "matched" | "new_group" | "missing" | "ambiguous" | "ignored";

export type GroupCandidate = {
  id: number;
  name: string;
  groupNumber?: string | null;
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

const businessSuffix = /\b(llc|l\.l\.c|inc|incorporated|corp|corporation|ltd|limited|llp|pc|co|company)\b/g;

export function normalizeGroupSearchKey(value: string | null | undefined) {
  const text = normalizeGroupText(value);
  if (!text) return null;
  const collapsed = text
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(businessSuffix, " ")
    .replace(/\s+/g, " ")
    .trim();
  return collapsed || null;
}

export function groupSearchTokens(value: string | null | undefined) {
  return (normalizeGroupSearchKey(value) ?? "").split(" ").filter(Boolean);
}

export function groupMatchesQuery(
  group: Pick<GroupCandidate, "name" | "groupNumber">,
  query: string | null | undefined,
) {
  const tokens = groupSearchTokens(query);
  if (tokens.length === 0) return true;
  const haystack = [
    normalizeGroupSearchKey(group.name),
    normalizeGroupText(group.name),
    normalizeGroupText(group.groupNumber),
    normalizeGroupSearchKey(group.groupNumber),
  ].filter(Boolean).join(" ");
  return tokens.every((token) => haystack.includes(token));
}

export type GroupSuggestion = {
  id: number;
  name: string;
  groupNumber?: string | null;
  score: number;
  strong: boolean;
  reason: string;
};

export function suggestGroupCandidates(
  groups: GroupCandidate[],
  sourceName: string | null | undefined,
  sourceNumber: string | null | undefined,
  limit = 5,
): GroupSuggestion[] {
  const name = normalizeGroupText(sourceName);
  const number = normalizeGroupText(sourceNumber);
  const searchKey = normalizeGroupSearchKey(sourceName);
  const sourceTokens = groupSearchTokens(sourceName);
  const ranked = groups.map((group) => {
    const groupName = normalizeGroupText(group.name);
    const groupNumber = normalizeGroupText(group.groupNumber);
    const groupKey = normalizeGroupSearchKey(group.name);
    let score = 0;
    let reason = "";
    let strong = false;
    if (number && groupNumber && number === groupNumber) {
      score = 100;
      reason = "Group number matches";
      strong = true;
    } else if (name && groupName && name === groupName) {
      score = 95;
      reason = "Name matches";
      strong = true;
    } else if (searchKey && groupKey && searchKey === groupKey) {
      score = 90;
      reason = "Name matches after formatting";
      strong = true;
    } else if (sourceTokens.length >= 2 && groupKey) {
      const hits = sourceTokens.filter((token) => groupKey.includes(token)).length;
      if (hits === sourceTokens.length) {
        score = 75;
        reason = "All name words found";
      } else if (hits >= Math.max(2, sourceTokens.length - 1) && hits / sourceTokens.length >= 0.75) {
        score = 70;
        reason = "Most name words found";
      }
    }
    if (!score && searchKey && groupKey && (groupKey.includes(searchKey) || searchKey.includes(groupKey)) && Math.min(searchKey.length, groupKey.length) >= 8) {
      score = 65;
      reason = "Partial name match";
    }
    return { id: group.id, name: group.name, groupNumber: group.groupNumber ?? null, score, strong, reason };
  }).filter((item) => item.score >= 70).sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));

  const strongCount = ranked.filter((item) => item.strong).length;
  return ranked.slice(0, limit).map((item) => (
    item.strong && strongCount !== 1 ? { ...item, strong: false } : item
  ));
}

export function defaultGroupImportAction(
  groups: GroupCandidate[],
  sourceName: string | null | undefined,
  sourceNumber: string | null | undefined,
) {
  const suggestions = suggestGroupCandidates(groups, sourceName, sourceNumber);
  const strong = suggestions.filter((item) => item.strong);
  if (strong.length === 1) {
    return { action: "match" as const, existingGroupId: strong[0]!.id, suggestion: strong[0]! };
  }
  return { action: "create" as const, existingGroupId: null, suggestion: null };
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
  groupId: number | null;
  sourceName: string | null;
  sourceNumber: string | null;
  action?: "create" | "match" | "ignore";
};


export function applyGroupResolutions(
  match: GroupMatch,
  resolutions: GroupImportResolution[] | undefined,
  groups: GroupCandidate[],
): GroupMatch {
  const key = unmatchedGroupIdentity(match.sourceName, match.sourceNumber);
  const resolution = resolutions?.find((item) => item.key === key);
  if (resolution?.action === "ignore") {
    return {
      status: "ignored",
      groupId: null,
      groupName: null,
      sourceName: match.sourceName,
      sourceNumber: match.sourceNumber,
    };
  }
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
