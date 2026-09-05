import {
  displayGroupText,
  matchImportedGroup,
  normalizeGroupText,
  type GroupCandidate,
  type GroupMatch,
} from "./groupMatch";

export type CarrierGroupIdentity = {
  carrierId: number;
  externalGroupNumber: string;
  groupId: number;
};

export function normalizeExternalGroupNumber(value: string | null | undefined) {
  return normalizeGroupText(value);
}

export function findCarrierGroupIdentity(
  identities: CarrierGroupIdentity[],
  carrierId: number | null | undefined,
  sourceNumber: string | null | undefined,
) {
  const number = normalizeExternalGroupNumber(sourceNumber);
  if (!carrierId || !number) return [];
  return identities.filter((item) => item.carrierId === carrierId && item.externalGroupNumber === number);
}

export function matchCarrierGroupIdentity(
  groups: GroupCandidate[],
  sourceName: string | null | undefined,
  sourceNumber: string | null | undefined,
  input: {
    carrierId?: number | null;
    identities?: CarrierGroupIdentity[];
    requireNameConfirmation?: boolean;
  } = {},
): GroupMatch {
  const name = displayGroupText(sourceName);
  const number = displayGroupText(sourceNumber);
  if (!name && !number) {
    return { status: "missing", groupId: null, groupName: null, sourceName: name, sourceNumber: number };
  }

  const hits = findCarrierGroupIdentity(input.identities ?? [], input.carrierId, number);
  if (hits.length === 1) {
    const group = groups.find((item) => item.id === hits[0]!.groupId);
    if (group) {
      return { status: "matched", groupId: group.id, groupName: group.name, sourceName: name, sourceNumber: number };
    }
  }
  if (hits.length > 1) {
    return { status: "ambiguous", groupId: null, groupName: null, sourceName: name, sourceNumber: number };
  }

  if (input.requireNameConfirmation) {
    const normalizedName = normalizeGroupText(name);
    const nameMatches = normalizedName
      ? groups.filter((group) => normalizeGroupText(group.name) === normalizedName)
      : [];
    if (nameMatches.length > 1) {
      return { status: "ambiguous", groupId: null, groupName: null, sourceName: name, sourceNumber: number };
    }
    return { status: "new_group", groupId: null, groupName: null, sourceName: name, sourceNumber: number };
  }

  return matchImportedGroup(groups, sourceName, sourceNumber);
}
