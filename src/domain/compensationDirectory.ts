import { classifyGroupLobCompensation, type GroupLobCompensationKind } from "./groupCompensationStatus";
import { canonicalCoverageFamilyFromName, canonicalLineIdFor, canonicalLineKey, type CanonicalLine } from "./canonicalLob";
import { peopleFacingRecipients, peopleFacingSummary } from "./personCompensationModel";
import { personKey, type PersonIdentity } from "./agencyOwner";
import type { AllocationEntryInput, AllocationStatus, PersonKind } from "./allocations";
import { AGENCY_OWNER_DISPLAY_NAME } from "./agencyOwner";

export type CompensationDirectoryFilters = {
  query: string;
  carrierId: number | null;
  lineOfBusinessId: number | null;
  primaryAgentId: number | null;
  accountManagerId: number | null;
  recipientKey: string | null;
  teamId: number | null;
  compensationStatus: "all" | "configured" | "default" | "review_required";
  asOfMonth: string;
};

export type CompensationDirectorySourceRow = {
  groupId: number;
  groupName: string;
  groupNumber: string | null;
  primaryAgentId: number | null;
  primaryAgentName: string | null;
  accountManagerId: number | null;
  accountManagerName: string | null;
  carrierIds: number[];
  carrierNames: string[];
  lineOfBusinessId: number;
  lineOfBusinessName: string;
  allocations: Array<{
    id: number;
    status: AllocationStatus;
    effectiveStart: string;
    effectiveEnd: string | null;
    entries: Array<AllocationEntryInput & { personName?: string | null; teamName?: string | null; teamId?: number | null }>;
  }>;
};

export type CompensationDirectoryRow = {
  key: string;
  groupId: number;
  groupName: string;
  groupNumber: string | null;
  primaryAgentId: number | null;
  primaryAgentName: string | null;
  accountManagerId: number | null;
  accountManagerName: string | null;
  carrierIds: number[];
  carrierNames: string[];
  lineOfBusinessId: number;
  lineOfBusinessName: string;
  canonicalKey: string;
  compensationKind: GroupLobCompensationKind;
  compensationLabel: string;
  currentAllocationId: number | null;
  currentEffectiveStart: string | null;
  currentEffectiveEnd: string | null;
  recipientKeys: string[];
  teamIds: number[];
};

export function emptyCompensationDirectoryFilters(asOfMonth: string): CompensationDirectoryFilters {
  return {
    query: "",
    carrierId: null,
    lineOfBusinessId: null,
    primaryAgentId: null,
    accountManagerId: null,
    recipientKey: null,
    teamId: null,
    compensationStatus: "all",
    asOfMonth,
  };
}

export function buildCompensationDirectoryRows(input: {
  sources: CompensationDirectorySourceRow[];
  lines: CanonicalLine[];
  asOfMonth: string;
  owner: PersonIdentity | null;
  personName: (kind: PersonKind, id: number) => string;
}): CompensationDirectoryRow[] {
  const byCanonical = new Map<string, CompensationDirectorySourceRow[]>();
  for (const source of input.sources) {
    const key = canonicalLineKey(source.groupId, {
      id: source.lineOfBusinessId,
      name: source.lineOfBusinessName,
    });
    const current = byCanonical.get(key) ?? [];
    current.push(source);
    byCanonical.set(key, current);
  }

  return [...byCanonical.entries()].map(([canonicalKey, sources]) => {
    const first = sources[0]!;
    const representativeId = canonicalLineIdFor({
      id: first.lineOfBusinessId,
      name: first.lineOfBusinessName,
    }, input.lines);
    const representative = sources.find((row) => row.lineOfBusinessId === representativeId) ?? first;
    const allocations = sources.flatMap((row) => row.allocations);
    const classified = classifyGroupLobCompensation({
      asOfMonth: input.asOfMonth,
      allocations,
    });
    const uniqueCovering = allocations.filter((row) => (
      row.status === "active"
      && row.effectiveStart <= input.asOfMonth
      && (row.effectiveEnd == null || row.effectiveEnd >= input.asOfMonth)
    ));
    const uniqueLineIds = new Set(uniqueCovering.flatMap((row) => (
      sources.filter((source) => source.allocations.some((allocation) => allocation.id === row.id))
        .map((source) => source.lineOfBusinessId)
    )));
    let kind = uniqueCovering.length > 1 && uniqueLineIds.size > 1 ? "review_required" as const : classified.kind;
    let facing: ReturnType<typeof peopleFacingRecipients> = [];
    try {
      facing = uniqueCovering[0] && kind !== "review_required"
        ? peopleFacingRecipients({
          entries: uniqueCovering[0].entries,
          owner: input.owner,
          personName: input.personName,
          ownerDisplayName: AGENCY_OWNER_DISPLAY_NAME,
        })
        : [];
    } catch {
      kind = "review_required";
      facing = [];
    }
    const recipientKeys = facing.length > 0
      ? facing.map((row) => personKey(row))
      : (input.owner && (
        kind === "default_unconfigured"
        || kind === "historical"
        || kind === "future"
        || kind === "inactive"
      ) ? [personKey(input.owner)] : []);
    const teamIds = [...new Set(allocations.flatMap((row) => (
      row.entries.flatMap((entry) => entry.teamId == null ? [] : [entry.teamId])
    )))];
    return {
      key: canonicalKey,
      groupId: representative.groupId,
      groupName: representative.groupName,
      groupNumber: representative.groupNumber,
      primaryAgentId: representative.primaryAgentId,
      primaryAgentName: representative.primaryAgentName,
      accountManagerId: representative.accountManagerId,
      accountManagerName: representative.accountManagerName,
      carrierIds: [...new Set(sources.flatMap((row) => row.carrierIds))],
      carrierNames: [...new Set(sources.flatMap((row) => row.carrierNames))],
      lineOfBusinessId: representativeId,
      lineOfBusinessName: input.lines.find((line) => line.id === representativeId)?.name ?? representative.lineOfBusinessName,
      canonicalKey,
      compensationKind: kind,
      compensationLabel: kind === "review_required"
        ? "Review required"
        : kind === "default_unconfigured" || kind === "historical" || kind === "future" || kind === "inactive"
          ? `${AGENCY_OWNER_DISPLAY_NAME} 100% — Default`
          : (facing.length > 0 ? peopleFacingSummary(facing) : classified.label),
      currentAllocationId: kind === "review_required" ? null : (classified.current?.id ?? null),
      currentEffectiveStart: classified.current?.effectiveStart ?? null,
      currentEffectiveEnd: classified.current?.effectiveEnd ?? null,
      recipientKeys,
      teamIds,
    };
  }).sort((left, right) => (
    left.groupName.localeCompare(right.groupName) || left.lineOfBusinessName.localeCompare(right.lineOfBusinessName)
  ));
}

export function filterCompensationDirectory(
  rows: CompensationDirectoryRow[],
  filters: CompensationDirectoryFilters,
  lines: CanonicalLine[] = [],
) {
  const needle = filters.query.trim().toLowerCase();
  const filterLine = filters.lineOfBusinessId != null
    ? lines.find((line) => line.id === filters.lineOfBusinessId) ?? null
    : null;
  const filterFamily = filterLine ? canonicalCoverageFamilyFromName(filterLine.name) : null;
  return rows.filter((row) => {
    if (needle) {
      const haystack = [row.groupName, row.groupNumber ?? "", ...row.carrierNames].join(" ").toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    if (filters.carrierId != null && !row.carrierIds.includes(filters.carrierId)) return false;
    if (filters.lineOfBusinessId != null) {
      if (filterFamily) {
        if (!row.canonicalKey.endsWith(`:${filterFamily}`)) return false;
      } else if (row.lineOfBusinessId !== filters.lineOfBusinessId) {
        return false;
      }
    }
    if (filters.primaryAgentId != null && row.primaryAgentId !== filters.primaryAgentId) return false;
    if (filters.accountManagerId != null && row.accountManagerId !== filters.accountManagerId) return false;
    if (filters.recipientKey && !row.recipientKeys.includes(filters.recipientKey)) return false;
    if (filters.teamId != null && !row.teamIds.includes(filters.teamId)) return false;
    if (filters.compensationStatus === "configured" && row.compensationKind !== "explicit_configured" && row.compensationKind !== "explicit_agency") {
      return false;
    }
    if (filters.compensationStatus === "default" && !(
      row.compensationKind === "default_unconfigured"
      || row.compensationKind === "historical"
      || row.compensationKind === "future"
      || row.compensationKind === "inactive"
    )) return false;
    if (filters.compensationStatus === "review_required" && row.compensationKind !== "review_required") return false;
    return true;
  });
}

export function selectAllDirectoryKeys(rows: CompensationDirectoryRow[]) {
  return rows.map((row) => row.key);
}
