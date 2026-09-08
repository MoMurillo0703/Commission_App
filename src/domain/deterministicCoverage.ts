import { normalizeCoverageValue } from "./carrierCoverage";
import type { NameMatch } from "./nameMatch";
import type { NamedLine } from "./carrierCoverage";

export const DETERMINISTIC_ANTHEM_COVERAGE_CODES = {
  med: "medical",
  medhmo: "medical",
  denppo: "dental",
  vis: "vision",
} as const;

export const CANONICAL_COVERAGE_NAMES = {
  medical: ["Group Medical", "Medical"],
  dental: ["Group Dental", "Dental"],
  vision: ["Group Vision", "Vision"],
} as const;

export type CanonicalCoverageFamily = keyof typeof CANONICAL_COVERAGE_NAMES;

export function isAnthemFamilyCarrier(name: string | null | undefined) {
  const value = name?.trim().toLowerCase() ?? "";
  return /\banthem\b/.test(value) || /\belevance\b/.test(value);
}

export function deterministicCoverageFamily(
  carrierName: string | null | undefined,
  sourceValue: string | null | undefined,
): CanonicalCoverageFamily | null {
  if (!isAnthemFamilyCarrier(carrierName)) return null;
  const normalized = normalizeCoverageValue(sourceValue);
  if (!normalized) return null;
  return DETERMINISTIC_ANTHEM_COVERAGE_CODES[normalized as keyof typeof DETERMINISTIC_ANTHEM_COVERAGE_CODES] ?? null;
}

export function findCanonicalCoverageLine(lines: NamedLine[], family: CanonicalCoverageFamily) {
  for (const name of CANONICAL_COVERAGE_NAMES[family]) {
    const match = lines.find((line) => line.name.trim().toLowerCase() === name.toLowerCase());
    if (match) return match;
  }
  return null;
}

export function applyDeterministicCoverageMapping(
  match: NameMatch,
  input: {
    carrierName: string | null | undefined;
    sourceValue: string | null | undefined;
    lines: NamedLine[];
  },
): NameMatch {
  if (match.status === "ignored" || match.status === "missing") return match;
  const family = deterministicCoverageFamily(input.carrierName, input.sourceValue);
  if (!family) return match;
  const canonical = findCanonicalCoverageLine(input.lines, family);
  if (!canonical) return match;
  if (match.status === "matched" && match.id === canonical.id) return match;
  return {
    status: "matched",
    id: canonical.id,
    name: canonical.name,
    source: match.source ?? input.sourceValue ?? null,
  };
}
