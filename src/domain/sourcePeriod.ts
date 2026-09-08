import { isCaliforniaChoicePeriodLabel, isPaidMonth, parseFlexibleMonth } from "./dates";

export type CoverageOrSourcePeriod = {
  kind: "coverage" | "source_period" | "unknown";
  label: "Coverage Month" | "Source Period";
  value: string | null;
};

export function classifyImportedPeriod(value: string | null | undefined): {
  coverageMonth: string | null;
  sourcePeriodLabel: string | null;
  invalid: boolean;
} {
  const raw = value?.trim() || null;
  if (!raw) return { coverageMonth: null, sourcePeriodLabel: null, invalid: false };
  const coverageMonth = parseFlexibleMonth(raw);
  if (coverageMonth) {
    return {
      coverageMonth,
      sourcePeriodLabel: isPaidMonth(raw) ? null : raw,
      invalid: false,
    };
  }
  if (isCaliforniaChoicePeriodLabel(raw)) {
    return { coverageMonth: null, sourcePeriodLabel: raw, invalid: false };
  }
  return { coverageMonth: null, sourcePeriodLabel: raw, invalid: true };
}

export function coverageOrSourcePeriod(input: {
  premiumMonth?: string | null;
  coverageMonth?: string | null;
  sourcePeriodLabel?: string | null;
}): CoverageOrSourcePeriod {
  const coverage = input.premiumMonth ?? input.coverageMonth ?? null;
  if (coverage && isPaidMonth(coverage)) {
    return { kind: "coverage", label: "Coverage Month", value: coverage };
  }
  if (input.sourcePeriodLabel?.trim()) {
    return { kind: "source_period", label: "Source Period", value: input.sourcePeriodLabel.trim() };
  }
  return { kind: "unknown", label: "Coverage Month", value: null };
}
