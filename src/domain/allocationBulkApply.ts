import type { AllocationEntryInput } from "./allocations";

export type LineApplyMode = "template" | "agency" | "skip";

export function agencyOnlyAllocationEntries(): AllocationEntryInput[] {
  return [{ recipientType: "agency", compensationBps: 10000 }];
}

export function defaultLineApplyMode(
  lineId: number,
  selectedLineId: number | null,
  missingLineIds: number[],
  coveredLineIds: number[],
): LineApplyMode {
  if (coveredLineIds.includes(lineId)) return "skip";
  if (selectedLineId === lineId || missingLineIds.includes(lineId)) return "template";
  return "skip";
}

export function plannedAllocationTargets(input: {
  lineIds: number[];
  modes: Record<number, LineApplyMode>;
  templateEntries: AllocationEntryInput[];
}) {
  return input.lineIds.flatMap((lineOfBusinessId) => {
    const mode = input.modes[lineOfBusinessId] ?? "skip";
    if (mode === "skip") return [];
    return [{
      lineOfBusinessId,
      mode,
      entries: mode === "agency" ? agencyOnlyAllocationEntries() : input.templateEntries,
    }];
  });
}
