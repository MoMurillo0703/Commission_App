import { CANONICAL_COVERAGE_NAMES, type CanonicalCoverageFamily } from "./deterministicCoverage";

export type CanonicalLine = {
  id: number;
  name: string;
};

const FAMILY_ALIASES: Record<string, CanonicalCoverageFamily> = {
  "group medical": "medical",
  medical: "medical",
  med: "medical",
  medhmo: "medical",
  "group dental": "dental",
  dental: "dental",
  denppo: "dental",
  "group vision": "vision",
  vision: "vision",
  vis: "vision",
};

export function canonicalCoverageFamilyFromName(name: string | null | undefined): CanonicalCoverageFamily | null {
  const normalized = name?.trim().toLowerCase() ?? "";
  if (!normalized) return null;
  return FAMILY_ALIASES[normalized] ?? null;
}

export function canonicalLineKey(groupId: number, line: CanonicalLine) {
  const family = canonicalCoverageFamilyFromName(line.name);
  return family ? `${groupId}:${family}` : `${groupId}:line:${line.id}`;
}

export function preferredCanonicalLineId(lines: CanonicalLine[], family: CanonicalCoverageFamily) {
  for (const name of CANONICAL_COVERAGE_NAMES[family]) {
    const match = lines.find((line) => line.name.trim().toLowerCase() === name.toLowerCase());
    if (match) return match.id;
  }
  return lines.find((line) => canonicalCoverageFamilyFromName(line.name) === family)?.id ?? null;
}

export function canonicalLineIdFor(line: CanonicalLine, lines: CanonicalLine[]) {
  const family = canonicalCoverageFamilyFromName(line.name);
  if (!family) return line.id;
  return preferredCanonicalLineId(lines, family) ?? line.id;
}

export function canonicalLineIdsMatching(lineId: number | null | undefined, lines: CanonicalLine[]) {
  if (lineId == null) return null;
  const line = lines.find((item) => item.id === lineId);
  if (!line) return [lineId];
  const key = canonicalLineKey(0, line);
  const matches = lines.filter((item) => canonicalLineKey(0, item) === key).map((item) => item.id);
  return matches.length > 0 ? matches : [lineId];
}

export function coveringAllocationsForCanonicalPair<T extends {
  id: number;
  groupId: number;
  lineOfBusinessId: number;
  status: string;
  effectiveStart: string;
  effectiveEnd: string | null;
}>(
  allocations: T[],
  query: { groupId: number; lineOfBusinessId: number; paidMonth: string },
  lines: CanonicalLine[],
  paidMonthInRange: (month: string, start: string, end: string | null) => boolean,
) {
  const queryLine = lines.find((line) => line.id === query.lineOfBusinessId);
  if (!queryLine) {
    return allocations.filter((allocation) => (
      allocation.status === "active"
      && allocation.groupId === query.groupId
      && allocation.lineOfBusinessId === query.lineOfBusinessId
      && paidMonthInRange(query.paidMonth, allocation.effectiveStart, allocation.effectiveEnd)
    ));
  }
  const key = canonicalLineKey(query.groupId, queryLine);
  return allocations.filter((allocation) => {
    if (allocation.status !== "active" || allocation.groupId !== query.groupId) return false;
    if (!paidMonthInRange(query.paidMonth, allocation.effectiveStart, allocation.effectiveEnd)) return false;
    const line = lines.find((item) => item.id === allocation.lineOfBusinessId);
    if (!line) return allocation.lineOfBusinessId === query.lineOfBusinessId;
    return canonicalLineKey(allocation.groupId, line) === key;
  });
}
