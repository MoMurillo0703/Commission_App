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
