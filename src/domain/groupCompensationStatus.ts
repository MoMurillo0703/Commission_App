import { allocationTotals, overlappingActiveAllocations, type AllocationStatus } from "./allocations";
import { AGENCY_OWNER_LABEL } from "./agencyOwner";
import { classifyRequestedAllocation } from "./allocationTerms";
import { formatStatementMonth, nextPaidMonth, paidMonthInRange } from "./dates";
import { bpsToPercentString } from "./money";

export type GroupLobCompensationKind =
  | "explicit_configured"
  | "explicit_agency"
  | "default_unconfigured"
  | "future"
  | "historical"
  | "review_required";

export type GroupLobCompensationAllocation = {
  id: number;
  status: AllocationStatus;
  effectiveStart: string;
  effectiveEnd: string | null;
  entries: Array<{
    recipientType: string;
    personKind?: string | null;
    personId?: number | null;
    teamId?: number | null;
    personName?: string | null;
    teamName?: string | null;
    compensationBps: number;
  }>;
};

export type GroupLobCompensationView = {
  kind: GroupLobCompensationKind;
  label: string;
  statusLabel: string;
  recipientSummary: string;
  current: GroupLobCompensationAllocation | null;
  future: GroupLobCompensationAllocation | null;
  historical: GroupLobCompensationAllocation[];
  configured: boolean;
  invalid: boolean;
  setupOpportunity: boolean;
};

function isAgencyOnly(allocation: GroupLobCompensationAllocation | null | undefined) {
  return Boolean(
    allocation
    && allocation.entries.length === 1
    && allocation.entries[0]?.recipientType === "agency"
    && allocation.entries[0]?.compensationBps === 10000,
  );
}

function recipientSummary(allocation: GroupLobCompensationAllocation | null | undefined) {
  if (!allocation) return `${AGENCY_OWNER_LABEL} 100%`;
  return allocation.entries
    .map((entry) => {
      const name = entry.recipientType === "agency"
        ? AGENCY_OWNER_LABEL
        : (entry.personName ?? entry.teamName ?? "Recipient");
      return `${name} ${bpsToPercentString(entry.compensationBps)}%`;
    })
    .join(" · ");
}

function isCompleteActive(allocation: GroupLobCompensationAllocation) {
  return allocation.status === "active" && allocationTotals(allocation.entries).complete;
}

export function classifyGroupLobCompensation(input: {
  asOfMonth: string;
  allocations: GroupLobCompensationAllocation[];
}): GroupLobCompensationView {
  const covering = input.allocations
    .filter((row) => isCompleteActive(row) && paidMonthInRange(input.asOfMonth, row.effectiveStart, row.effectiveEnd))
    .sort((left, right) => right.effectiveStart.localeCompare(left.effectiveStart) || left.id - right.id);
  const incompleteCovering = input.allocations.filter((row) => (
    row.status === "active"
    && paidMonthInRange(input.asOfMonth, row.effectiveStart, row.effectiveEnd)
    && !allocationTotals(row.entries).complete
  ));
  const future = input.allocations
    .filter((row) => isCompleteActive(row) && row.effectiveStart > input.asOfMonth)
    .sort((left, right) => left.effectiveStart.localeCompare(right.effectiveStart) || left.id - right.id)[0] ?? null;
  const historical = input.allocations
    .filter((row) => row.effectiveEnd != null && row.effectiveEnd < input.asOfMonth)
    .sort((left, right) => right.effectiveStart.localeCompare(left.effectiveStart) || left.id - right.id);

  if (covering.length > 1 || incompleteCovering.length > 0) {
    const current = covering[0] ?? incompleteCovering[0] ?? null;
    return {
      kind: "review_required",
      label: "Review required",
      statusLabel: incompleteCovering.length > 0
        ? "Current allocation does not total 100%"
        : "More than one active allocation covers this month",
      recipientSummary: recipientSummary(current),
      current,
      future,
      historical,
      configured: false,
      invalid: true,
      setupOpportunity: false,
    };
  }

  const current = covering[0] ?? null;
  if (current && isAgencyOnly(current)) {
    return {
      kind: "explicit_agency",
      label: `${AGENCY_OWNER_LABEL} 100% — Configured`,
      statusLabel: "Configured",
      recipientSummary: recipientSummary(current),
      current,
      future,
      historical,
      configured: true,
      invalid: false,
      setupOpportunity: false,
    };
  }
  if (current) {
    return {
      kind: "explicit_configured",
      label: recipientSummary(current),
      statusLabel: "Configured",
      recipientSummary: recipientSummary(current),
      current,
      future,
      historical,
      configured: true,
      invalid: false,
      setupOpportunity: false,
    };
  }
  if (future) {
    return {
      kind: "future",
      label: `Future configuration starts ${formatStatementMonth(future.effectiveStart)}`,
      statusLabel: "Future",
      recipientSummary: recipientSummary(future),
      current: null,
      future,
      historical,
      configured: false,
      invalid: false,
      setupOpportunity: true,
    };
  }
  if (historical.length > 0) {
    return {
      kind: "historical",
      label: `${AGENCY_OWNER_LABEL} 100% — Default / not explicitly configured`,
      statusLabel: "Default",
      recipientSummary: `${AGENCY_OWNER_LABEL} 100% — Default`,
      current: null,
      future: null,
      historical,
      configured: false,
      invalid: false,
      setupOpportunity: true,
    };
  }
  return {
    kind: "default_unconfigured",
    label: `${AGENCY_OWNER_LABEL} 100% — Default / not explicitly configured`,
    statusLabel: "Default",
    recipientSummary: `${AGENCY_OWNER_LABEL} 100% — Default`,
    current: null,
    future: null,
    historical: [],
    configured: false,
    invalid: false,
    setupOpportunity: true,
  };
}

export function rollupGroupCompensationStatus(lines: Array<{ kind: GroupLobCompensationKind }>): {
  kind: GroupLobCompensationKind | "none";
  label: string;
} {
  if (lines.length === 0) return { kind: "none", label: "No coverage on file" };
  if (lines.some((line) => line.kind === "review_required")) return { kind: "review_required", label: "Review required" };
  if (lines.every((line) => line.kind === "explicit_configured" || line.kind === "explicit_agency")) {
    return { kind: "explicit_configured", label: "Configured" };
  }
  if (lines.some((line) => line.kind === "default_unconfigured" || line.kind === "historical" || line.kind === "future")) {
    return { kind: "default_unconfigured", label: "Default / not explicitly configured" };
  }
  return { kind: "explicit_configured", label: "Configured" };
}

export function splitEditProgressLabel(allocatedBps: number) {
  const remaining = 10000 - allocatedBps;
  const allocatedPct = (allocatedBps / 100).toFixed(allocatedBps % 100 === 0 ? 0 : 2);
  if (allocatedBps === 10000) return "Allocated: 100% · Ready to Save";
  if (allocatedBps > 10000) {
    const overPct = ((allocatedBps - 10000) / 100).toFixed((allocatedBps - 10000) % 100 === 0 ? 0 : 2);
    return `Allocated: ${allocatedPct}% · Over by ${overPct}%`;
  }
  const remainingPct = (remaining / 100).toFixed(remaining % 100 === 0 ? 0 : 2);
  return `Allocated: ${allocatedPct}% · Remaining: ${remainingPct}%`;
}

export function canSaveExplicitSplit(allocatedBps: number) {
  return allocatedBps === 10000;
}

export function suggestedCompensationChangeStart(asOfMonth: string, currentStart: string | null) {
  if (!currentStart) return asOfMonth;
  if (asOfMonth > currentStart) return asOfMonth;
  return nextPaidMonth(currentStart);
}

export function compensationChangeConflictMessage(input: {
  requestedStart: string;
  requestedEnd?: string | null;
  siblings: Array<{
    id?: number;
    groupId: number;
    lineOfBusinessId: number;
    effectiveStart: string;
    effectiveEnd: string | null;
    status: AllocationStatus;
    entries: Array<{ recipientType: "agency" | "person" | "team"; personKind?: "agent" | "account_manager" | null; personId?: number | null; teamId?: number | null; compensationBps: number }>;
  }>;
  requested: {
    groupId: number;
    lineOfBusinessId: number;
    effectiveStart: string;
    effectiveEnd?: string | null;
    entries: Array<{ recipientType: "agency" | "person" | "team"; personKind?: "agent" | "account_manager" | null; personId?: number | null; teamId?: number | null; compensationBps: number }>;
  };
}): string | null {
  const classified = classifyRequestedAllocation(input.siblings, input.requested);
  if (classified.status !== "conflict") return null;
  const overlaps = overlappingActiveAllocations(input.siblings, input.requestedStart, input.requestedEnd ?? null);
  const current = overlaps.sort((left, right) => right.effectiveStart.localeCompare(left.effectiveStart))[0];
  if (!current) {
    return "An active compensation allocation already covers this period. Existing terms were not changed.";
  }
  const currentRange = `${formatStatementMonth(current.effectiveStart)} → ${current.effectiveEnd ? formatStatementMonth(current.effectiveEnd) : "Present"}`;
  if (current.effectiveStart > input.requestedStart) {
    return `An active allocation already starts in ${formatStatementMonth(current.effectiveStart)} (${currentRange}). ${formatStatementMonth(input.requestedStart)} would overlap that later period. To change current terms, choose ${formatStatementMonth(current.effectiveStart)} or later. The prior period will close the month before the new start. Earlier history stays unchanged.`;
  }
  if (current.effectiveStart === input.requestedStart) {
    return `An active allocation already starts in ${formatStatementMonth(input.requestedStart)} (${currentRange}). Active allocations are not overwritten. Choose a later effective start to version forward; the current allocation will end the month before that start.`;
  }
  return `An active allocation already covers ${currentRange}. Choose an effective start after ${formatStatementMonth(current.effectiveStart)} to version forward without changing history.`;
}
