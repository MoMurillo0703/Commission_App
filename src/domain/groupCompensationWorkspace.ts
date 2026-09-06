import { plannedAllocationTargets, type LineApplyMode } from "./allocationBulkApply";
import { allocationEntryPayload, type DraftRecipient } from "./allocationEditor";
import {
  afterGroupQueueRefresh,
  groupCompensationQueue,
  groupQueueNeedsLabel,
  type CompensationQueueItem,
} from "./compensationQueue";
import type { GroupLineEvidence } from "./activeGroupLines";
import type { CompensationHomeAllocation } from "./compensationHome";
import {
  coverageArrangementLabel,
  defaultCoverageModes,
  groupCoverageLines,
  type GroupCoverageLine,
} from "./groupCoverage";

export type WorkspaceTemplateEntry = {
  recipientType: string;
  personKind?: string | null;
  personId?: number | null;
  teamId?: number | null;
  compensationBps: number;
};

export function coverageModeForLine(line: GroupCoverageLine, modes: Record<number, LineApplyMode>): LineApplyMode {
  return modes[line.lineOfBusinessId] ?? (line.needsSetup ? "template" : "skip");
}

export function buildGroupCompensationWorkspace(input: {
  pairs: CompensationQueueItem[];
  groupId: number;
  lines: Array<{ id: number; name: string }>;
  evidence: GroupLineEvidence[];
  allocations: CompensationHomeAllocation[];
  templateEntries?: WorkspaceTemplateEntry[];
}) {
  const queue = groupCompensationQueue(input.pairs);
  const queueItem = queue.find((item) => item.groupId === input.groupId) ?? null;
  const coverage = groupCoverageLines({
    groupId: input.groupId,
    lines: input.lines,
    evidence: input.evidence,
    allocations: input.allocations,
    keepLineIds: queueItem?.lineOfBusinessIds ?? [],
  });
  const modes = defaultCoverageModes(coverage);
  return {
    queue,
    queueItem,
    queueNeedsLabel: queueItem ? groupQueueNeedsLabel(queueItem.needingLineCount) : null,
    coverage,
    modes,
    rows: coverage.map((line) => ({
      lineOfBusinessId: line.lineOfBusinessId,
      name: line.name,
      status: coverageArrangementLabel(line, input.templateEntries),
      needsSetup: line.needsSetup,
      configured: line.configured,
      selectedByDefault: coverageModeForLine(line, modes) !== "skip",
      recipientSummary: line.recipientSummary,
    })),
    applyTargets: plannedAllocationTargets({
      lineIds: coverage.map((line) => line.lineOfBusinessId),
      modes,
      templateEntries: (input.templateEntries ?? []).map((entry) => ({
        recipientType: entry.recipientType as "agency" | "person" | "team",
        personKind: entry.personKind as "agent" | "account_manager" | null | undefined,
        personId: entry.personId,
        teamId: entry.teamId,
        compensationBps: entry.compensationBps,
      })),
    }),
  };
}

export function bulkAllocationRequestBody(input: {
  groupId: number;
  effectiveStart: string;
  effectiveEnd: string;
  targets: ReturnType<typeof plannedAllocationTargets>;
  draftEntries: DraftRecipient[];
}) {
  return {
    groupId: input.groupId,
    effectiveStart: input.effectiveStart,
    effectiveEnd: input.effectiveEnd,
    status: "active" as const,
    targets: input.targets.map((target) => ({
      lineOfBusinessId: target.lineOfBusinessId,
      entries: allocationEntryPayload(
        target.mode === "agency"
          ? [{ recipientType: "agency", personKind: "", personId: "", teamId: "", percent: "100" }]
          : input.draftEntries,
      ),
    })),
  };
}

export function afterGroupWorkspaceApply<T extends { groupId: number }>(
  remaining: T[],
  currentGroupId: number,
  index: number,
) {
  return afterGroupQueueRefresh(remaining, currentGroupId, index);
}
