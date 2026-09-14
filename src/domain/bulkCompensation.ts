import { fingerprintBuffer } from "./fingerprint";
import { stableJson } from "./compensationCorrection";
import { previousPaidMonth } from "./dates";
import { classifyRequestedAllocation } from "./allocationTerms";
import type { AllocationEntryInput, AllocationStatus } from "./allocations";
import { persistPeopleSplit, recipientFingerprint } from "./personCompensationModel";
import { expandTeamTemplate, type TemplateTeam } from "./teamTemplate";
import type { PersonIdentity } from "./agencyOwner";

export type BulkCompensationSibling = {
  id: number;
  lineOfBusinessId: number;
  effectiveStart: string;
  effectiveEnd: string | null;
  status: AllocationStatus;
  entries: AllocationEntryInput[];
};

export type BulkCompensationTarget = {
  key: string;
  groupId: number;
  groupName: string;
  lineOfBusinessId: number;
  lineOfBusinessName: string;
  siblingLineIds: number[];
  siblings: BulkCompensationSibling[];
  current: BulkCompensationSibling | null;
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

export function siblingStateFingerprint(siblings: BulkCompensationSibling[]) {
  return siblings
    .map((row) => [
      row.id,
      row.lineOfBusinessId,
      row.effectiveStart,
      row.effectiveEnd ?? "",
      row.status,
      recipientFingerprint(row.entries),
    ].join(":"))
    .sort()
    .join("|");
}

export function templateStateFingerprint(team: TemplateTeam | null | undefined) {
  if (!team) return "";
  return [
    team.id,
    team.status ?? "active",
    ...team.members
      .map((member) => [
        member.personKind,
        member.personId,
        member.shareBps,
        member.status,
        member.effectiveStart,
        member.effectiveEnd ?? "",
      ].join(":"))
      .sort(),
  ].join("|");
}

export function bulkCompensationPreviewToken(input: {
  effectiveStart: string;
  ownerKey: string | null;
  templateId: number | null;
  templateFingerprint: string;
  entries: AllocationEntryInput[];
  targets: Array<{
    groupId: number;
    lineOfBusinessId: number;
    siblingLineIds: number[];
    siblingFingerprint: string;
  }>;
}) {
  return fingerprintBuffer(new TextEncoder().encode(stableJson({
    effectiveStart: input.effectiveStart,
    ownerKey: input.ownerKey,
    templateId: input.templateId,
    templateFingerprint: input.templateFingerprint,
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

function coveringSiblings(target: BulkCompensationTarget, effectiveStart: string) {
  return target.siblings.filter((row) => (
    row.status === "active"
    && row.effectiveStart <= effectiveStart
    && (row.effectiveEnd == null || row.effectiveEnd >= effectiveStart)
  ));
}

export function planBulkCompensation(input: {
  targets: BulkCompensationTarget[];
  entries: AllocationEntryInput[];
  effectiveStart: string;
  proposedSummary: string;
  currentSummary: (entries: AllocationEntryInput[]) => string;
}): BulkCompensationPreviewRow[] {
  return input.targets.map((target) => {
    const covering = coveringSiblings(target, input.effectiveStart);
    if (covering.length > 1) {
      return {
        key: target.key,
        groupId: target.groupId,
        groupName: target.groupName,
        lineOfBusinessId: target.lineOfBusinessId,
        lineOfBusinessName: target.lineOfBusinessName,
        action: "conflict" as const,
        currentSummary: "Review required",
        proposedSummary: input.proposedSummary,
        closePriorEnd: null,
        warning: "Multiple allocations cover this canonical Group and Line of Coverage. Nothing was selected.",
      };
    }
    const siblings = target.siblings.map((row) => ({
      id: row.id,
      groupId: target.groupId,
      lineOfBusinessId: target.lineOfBusinessId,
      effectiveStart: row.effectiveStart,
      effectiveEnd: row.effectiveEnd,
      status: row.status,
      entries: row.entries,
    }));
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
      currentSummary: target.current ? input.currentSummary(target.current.entries) : "Mo 100% — Default",
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
