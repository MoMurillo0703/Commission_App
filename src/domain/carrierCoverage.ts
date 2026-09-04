import type { NameMatch } from "./nameMatch";
import { normalizeNamedImportText } from "./namedImport";

export type CarrierCoverageAlias = {
  carrierId: number;
  sourceValue: string;
  lineOfBusinessId: number;
};

export type NamedLine = {
  id: number;
  name: string;
};

export function normalizeCoverageValue(value: string | null | undefined) {
  return normalizeNamedImportText(value);
}

export function findCarrierCoverageAlias(
  aliases: CarrierCoverageAlias[],
  carrierId: number | null | undefined,
  sourceValue: string | null | undefined,
) {
  const normalized = normalizeCoverageValue(sourceValue);
  if (!carrierId || !normalized) return null;
  return aliases.find((alias) => alias.carrierId === carrierId && alias.sourceValue === normalized) ?? null;
}

export function applyCarrierCoverageAlias(
  match: NameMatch,
  aliases: CarrierCoverageAlias[] | undefined,
  carrierId: number | null | undefined,
  sourceValue: string | null | undefined,
  lines: NamedLine[],
): NameMatch {
  if (match.status === "matched") return match;
  const alias = findCarrierCoverageAlias(aliases ?? [], carrierId, sourceValue);
  if (!alias) return match;
  const line = lines.find((item) => item.id === alias.lineOfBusinessId);
  if (!line) return match;
  return {
    status: "matched",
    id: line.id,
    name: line.name,
    source: match.source,
  };
}
