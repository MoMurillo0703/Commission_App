import { normalizeColumnMapping, type ColumnMapping } from "./columnMapping";

export type LayoutSignature = {
  headerFingerprint: string;
  firstPageTokens: string[];
};

const ignoredTokens = /^(page|of|statement|commission|commissions|the|and|for|to|a)$/i;

export function headerFingerprint(headers: string[]) {
  return headers
    .map((header) => header.trim().toLowerCase().replace(/\s+/g, " "))
    .filter(Boolean)
    .sort()
    .join("|");
}

export function firstPageTokens(text: string, limit = 12) {
  return text
    .split(/\s+/)
    .map((token) => token.replace(/[^a-zA-Z0-9]/g, "").toLowerCase())
    .filter((token) => token.length > 2 && !ignoredTokens.test(token))
    .slice(0, limit);
}

export function buildLayoutSignature(headers: string[], firstPageText: string): LayoutSignature {
  return {
    headerFingerprint: headerFingerprint(headers),
    firstPageTokens: firstPageTokens(firstPageText),
  };
}

export function signaturesMatch(saved: LayoutSignature, incoming: LayoutSignature) {
  if (!saved.headerFingerprint || !incoming.headerFingerprint) return false;
  if (saved.headerFingerprint !== incoming.headerFingerprint) return false;
  if (saved.firstPageTokens.length === 0 || incoming.firstPageTokens.length === 0) return true;
  const incomingSet = new Set(incoming.firstPageTokens);
  const overlap = saved.firstPageTokens.filter((token) => incomingSet.has(token)).length;
  return overlap >= Math.min(3, saved.firstPageTokens.length);
}

export function parseLayoutSignature(json: string | null | undefined): LayoutSignature | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as LayoutSignature;
    if (!parsed.headerFingerprint) return null;
    return {
      headerFingerprint: parsed.headerFingerprint,
      firstPageTokens: Array.isArray(parsed.firstPageTokens) ? parsed.firstPageTokens : [],
    };
  } catch {
    return null;
  }
}

export function mappingsEqual(left: ColumnMapping, right: ColumnMapping) {
  const a = normalizeColumnMapping(left);
  const b = normalizeColumnMapping(right);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if ((a[key as keyof ColumnMapping] ?? null) !== (b[key as keyof ColumnMapping] ?? null)) return false;
  }
  return true;
}
