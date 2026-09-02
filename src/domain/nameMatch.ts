export type NameMatchStatus = "matched" | "unmatched" | "missing" | "ambiguous";

export type NamedRecord = {
  id: number;
  name: string;
};

export type NameMatch = {
  status: NameMatchStatus;
  id: number | null;
  name: string | null;
  source: string | null;
};

function normalize(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

export function matchNamedRecord(records: NamedRecord[], source: string | null | undefined): NameMatch {
  const text = source?.trim() || null;
  if (!text) return { status: "missing", id: null, name: null, source: text };

  const matches = records.filter((record) => normalize(record.name) === normalize(text));
  if (matches.length === 1) {
    return { status: "matched", id: matches[0].id, name: matches[0].name, source: text };
  }
  if (matches.length > 1) {
    return { status: "ambiguous", id: null, name: null, source: text };
  }
  return { status: "unmatched", id: null, name: null, source: text };
}
