import { fingerprintBuffer } from "./fingerprint";
import { stableJson } from "./compensationCorrection";
import { previousPaidMonth } from "./dates";
import { classifyRequestedAllocation } from "./allocationTerms";
import type { AllocationEntryInput, AllocationStatus } from "./allocations";
import { persistPeopleSplit, recipientFingerprint } from "./personCompensationModel";
import { expandTeamTemplate, type TemplateTeam } from "./teamTemplate";
import type { PersonIdentity } from "./agencyOwner";

export type BulkCompensationTarget = {
  key: string;
  groupId: number;
  groupName: string;
  lineOfBusinessId: number;
  lineOfBusinessName: string;
  current: {
    id: number;
    effectiveStart: string;
    effectiveEnd: string | null;
    status: AllocationStatus;
    entries: AllocationEntryInput[];
  } | null;
};

export type BulkCompensationPreviewRow = {
  key: string;
  groupId: number;
  groupName: string;
  lineOfBusinessId: number;
  lineOfBusinessName: string;
  action: "create" | "version" | "reuse" | "conflict";
  currentSummary: string;
  proposedSummary: string;
  closePriorEnd: string | null;
  warning: string | null;
};

export function bulkCompensationPreviewToken(input: {
  effectiveStart: string;
  ownerKey: string | null;
  templateId: number | null;
  entries: AllocationEntryInput[];
  targets: Array<{
    groupId: number;
    lineOfBusinessId: number;
    currentId: number | null;
    currentFingerprint: string;
  }>;
}) {
  return fingerprintBuffer(new TextEncoder().encode(stableJson({
    effectiveStart: input.effectiveStart,
    ownerKey: input.ownerKey,
    templateId: input.templateId,
    entries: recipientFingerprint(input.entries),
    targets: [...input.targets].sort((left, right) => (
      left.groupId - right.groupId || left.lineOfBusinessId - right.lineOfBusinessId
    )),
  })));
}

export function resolveBulkProposedEntries(input: {
  mode: "template" | "custom";
  team?: TemplateTeam | null;
  people?: Array<{ personKind: "agent" | "account_manager"; personId: number; compensationBps: number }>;
  owner: PersonIdentity | null;
  effectiveStart: string;
}): AllocationEntryInput[] {
  if (input.mode === "template") {
    if (!input.team) throw new Error("Choose a compensation template.");
    return expandTeamTemplate({
      team: input.team,
      asOfMonth: input.effectiveStart,
      owner: input.owner,
    });
  }
  return persistPeopleSplit({
    owner: input.owner,
    people: input.people ?? [],
  });
}

export function planBulkCompensation(input: {
  targets: BulkCompensationTarget[];
  entries: AllocationEntryInput[];
  effectiveStart: string;
  proposedSummary: string;
  currentSummary: (entries: AllocationEntryInput[]) => string;
}): BulkCompensationPreviewRow[] {
  return input.targets.map((target) => {
    const siblings = target.current ? [{
      id: target.current.id,
      groupId: target.groupId,
      lineOfBusinessId: target.lineOfBusinessId,
      effectiveStart: target.current.effectiveStart,
      effectiveEnd: target.current.effectiveEnd,
      status: target.current.status,
      entries: target.current.entries,
    }] : [];
    const classified = classifyRequestedAllocation(siblings, {
      groupId: target.groupId,
      lineOfBusinessId: target.lineOfBusinessId,
      effectiveStart: input.effectiveStart,
      entries: input.entries,
    });
    if (classified.status === "exact") {
      return {
        key: target.key,
        groupId: target.groupId,
        groupName: target.groupName,
        lineOfBusinessId: target.lineOfBusinessId,
        lineOfBusinessName: target.lineOfBusinessName,
        action: "reuse" as const,
        currentSummary: target.current ? input.currentSummary(target.current.entries) : "Not configured",
        proposedSummary: input.proposedSummary,
        closePriorEnd: null,
        warning: null,
      };
    }
    if (classified.status === "conflict") {
      return {
        key: target.key,
        groupId: target.groupId,
        groupName: target.groupName,
        lineOfBusinessId: target.lineOfBusinessId,
        lineOfBusinessName: target.lineOfBusinessName,
        action: "conflict" as const,
        currentSummary: target.current ? input.currentSummary(target.current.entries) : "Not configured",
        proposedSummary: input.proposedSummary,
        closePriorEnd: null,
        warning: "An active allocation already covers this period and cannot be overwritten.",
      };
    }
    const closePriorEnd = target.current && target.current.effectiveStart < input.effectiveStart
      ? previousPaidMonth(input.effectiveStart)
      : null;
    return {
      key: target.key,
      groupId: target.groupId,
      groupName: target.groupName,
      lineOfBusinessId: target.lineOfBusinessId,
      lineOfBusinessName: target.lineOfBusinessName,
      action: target.current ? "version" as const : "create" as const,
      currentSummary: target.current ? input.currentSummary(target.current.entries) : `${"Mo"} 100% — Default`,
      proposedSummary: input.proposedSummary,
      closePriorEnd,
      warning: null,
    };
  });
}

export function staleBulkPreviewMessage() {
  return "The compensation preview is stale because the selected Groups, lines, or current allocations changed. Preview again. Nothing was saved.";
}

export function bulkPreviewHasConflicts(rows: BulkCompensationPreviewRow[]) {
  return rows.some((row) => row.action === "conflict");
}
