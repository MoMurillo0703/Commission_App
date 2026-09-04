export type GroupLineEvidence = {
  groupId: number;
  lineOfBusinessId: number;
};

export type NamedLine = {
  id: number;
  name: string;
};

export function activeLineIdsForGroup(groupId: number, evidence: GroupLineEvidence[]) {
  return [...new Set(
    evidence
      .filter((item) => item.groupId === groupId)
      .map((item) => item.lineOfBusinessId)
      .filter((id) => Number.isInteger(id) && id > 0),
  )].sort((left, right) => left - right);
}

export function linesForGroupSelection(
  groupId: number | null,
  lines: NamedLine[],
  evidence: GroupLineEvidence[],
  keepLineIds: Array<number | null | undefined> = [],
) {
  if (!groupId) return [];
  const allowed = new Set([
    ...activeLineIdsForGroup(groupId, evidence),
    ...keepLineIds.filter((id): id is number => typeof id === "number" && id > 0),
  ]);
  return lines.filter((line) => allowed.has(line.id));
}
