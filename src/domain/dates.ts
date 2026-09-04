export function formatStatementMonth(value: string) {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  return new Date(year, month - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" });
}

export function currentPaidMonth(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function formatPaidMonthTitle(value: string) {
  const [year, month] = value.split("-").map(Number);
  if (!year || !month) return value;
  const label = new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  return `${label} paid commissions`;
}

export const paidMonthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

const namedMonth = /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{4})$/i;
const namedMonthIndex: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

/** Accepts YYYY-MM, M/D/YYYY, or "Aug 2026" / "August 2026". Does not invent a month. */
export function parseFlexibleMonth(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (paidMonthPattern.test(trimmed)) return trimmed;
  const numeric = trimmed.match(/^(0?[1-9]|1[0-2])[/-]\d{1,2}[/-](\d{4})$/);
  if (numeric) return `${numeric[2]}-${numeric[1].padStart(2, "0")}`;
  const named = trimmed.match(namedMonth);
  if (!named) return null;
  const month = namedMonthIndex[named[1].slice(0, 3).toLowerCase()];
  return month ? `${named[2]}-${month}` : null;
}

export function isPaidMonth(value: string | null | undefined): value is string {
  return typeof value === "string" && paidMonthPattern.test(value);
}

export function previousPaidMonth(value: string) {
  if (!isPaidMonth(value)) throw new Error("Enter a paid month as YYYY-MM.");
  const [year, month] = value.split("-").map(Number);
  const date = new Date(year, month - 1, 1);
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function paidMonthInRange(month: string, start: string, end: string | null) {
  return month >= start && (end == null || month <= end);
}

export function paidMonthRangesOverlap(
  startA: string,
  endA: string | null,
  startB: string,
  endB: string | null,
) {
  return startA <= (endB ?? "9999-12") && startB <= (endA ?? "9999-12");
}
