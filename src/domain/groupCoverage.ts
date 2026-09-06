import { allocationTotals } from "./allocations";
import { allocationEntriesMatch } from "./allocationTerms";
import { linesForGroupSelection, type GroupLineEvidence } from "./activeGroupLines";
import { allocationRecipientSummary, type CompensationHomeAllocation } from "./compensationHome";
import type { LineApplyMode } from "./allocationBulkApply";

export type GroupCoverageLine = {
  lineOfBusinessId: number;
  name: string;
  needsSetup: boolean;
  configured: boolean;
  agencyOnly: boolean;
  recipientSummary: string | null;
  allocationId: number | null;
  entries: Array<CompensationHomeAllocation["entries"][number] & {
    personKind?: string | null;
    personId?: number | null;
    teamId?: number | null;
  }>;
};

function isCompleteActive(allocation: CompensationHomeAllocation) {
  return allocation.status === "active" && allocationTotals(allocation.entries).complete;
}

function isAgencyOnly(allocation: CompensationHomeAllocation | undefined) {
  return Boolean(
    allocation
    && allocation.entries.length === 1
    && allocation.entries[0]?.recipientType === "agency"
    && allocation.entries[0]?.compensationBps === 10000,
  );
}

export function groupCoverageLines(input: {
  groupId: number | null;
  lines: Array<{ id: number; name: string }>;
  evidence: GroupLineEvidence[];
  allocations: CompensationHomeAllocation[];
  keepLineIds?: number[];
}): GroupCoverageLine[] {
  const visible = linesForGroupSelection(input.groupId, input.lines, input.evidence, input.keepLineIds ?? []);
  if (!input.groupId) return [];
  return visible.map((line) => {
    const current = input.allocations.find((row) => (
      row.groupId === input.groupId
      && row.lineOfBusinessId === line.id
      && isCompleteActive(row)
    ));
    return {
      lineOfBusinessId: line.id,
      name: line.name,
      needsSetup: !current,
      configured: Boolean(current),
      agencyOnly: isAgencyOnly(current),
      recipientSummary: current ? allocationRecipientSummary(current) : null,
      allocationId: current?.id ?? null,
      entries: current?.entries ?? [],
    };
  });
}

export function coverageArrangementLabel(
  line: GroupCoverageLine,
  templateEntries?: Array<{
    recipientType: string;
    personKind?: string | null;
    personId?: number | null;
    teamId?: number | null;
    compensationBps: number;
  }>,
) {
  if (line.needsSetup) return "Needs setup";
  if (line.agencyOnly) return "Agency 100%";
  if (templateEntries && templateEntries.length > 0 && allocationEntriesMatch(
    templateEntries.map((entry) => ({
      recipientType: entry.recipientType as "agency" | "person" | "team",
      personKind: entry.personKind as "agent" | "account_manager" | null | undefined,
      personId: entry.personId,
      teamId: entry.teamId,
      compensationBps: entry.compensationBps,
    })),
    line.entries.map((entry) => ({
      recipientType: entry.recipientType as "agency" | "person" | "team",
      personKind: entry.personKind as "agent" | "account_manager" | null | undefined,
      personId: entry.personId,
      teamId: entry.teamId,
      compensationBps: entry.compensationBps,
    })),
  )) {
    return "Uses Group split";
  }
  if (line.recipientSummary) return `Override — ${line.recipientSummary}`;
  return "Already configured";
}

export function defaultCoverageModes(lines: GroupCoverageLine[]): Record<number, LineApplyMode> {
  return Object.fromEntries(lines.map((line) => [line.lineOfBusinessId, line.needsSetup ? "template" : "skip"]));
}

export function selectNeedingSetupModes(lines: GroupCoverageLine[]): Record<number, LineApplyMode> {
  return defaultCoverageModes(lines);
}

export function clearCoverageModes(lines: GroupCoverageLine[]): Record<number, LineApplyMode> {
  return Object.fromEntries(lines.map((line) => [line.lineOfBusinessId, "skip"]));
}

export function setCoverageMode(
  current: Record<number, LineApplyMode>,
  lineId: number,
  mode: LineApplyMode,
) {
  return { ...current, [lineId]: mode };
}
