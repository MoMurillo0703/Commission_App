import {
  bulkCompensationPreviewToken,
  bulkPreviewHasConflicts,
  planBulkCompensation,
  resolveBulkProposedEntries,
  staleBulkPreviewMessage,
  type BulkCompensationTarget,
} from "@/domain/bulkCompensation";
import { peopleFacingRecipients, peopleFacingSummary, recipientFingerprint } from "@/domain/personCompensationModel";
import { personKey } from "@/domain/agencyOwner";
import { AGENCY_OWNER_DISPLAY_NAME } from "@/domain/agencyOwner";
import type { AllocationEntryInput } from "@/domain/allocations";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { ConflictError, ValidationError } from "@/lib/errors";
import { getAgencyOwnerForPaidMonth } from "./agencyOwner";
import {
  applyAllocationWrites,
  listAllocations,
  listAllocationsForPair,
  type AllocationView,
} from "./allocations";
import { lockAllocationNamespaces } from "./allocationNamespaceLock";
import { listGroups } from "./groups";
import { listLinesOfBusiness } from "./linesOfBusiness";
import { listAgents } from "./agents";
import { listAccountManagers } from "./accountManagers";
import { getTeam } from "./teams";
import { canonicalLineIdFor } from "@/domain/canonicalLob";

export type BulkCompensationRequest = {
  effectiveStart: string;
  mode: "template" | "custom";
  teamId?: number | null;
  people?: Array<{ personKind: "agent" | "account_manager"; personId: number; compensationBps: number }>;
  targets: Array<{ groupId: number; lineOfBusinessId: number }>;
  previewToken?: string;
};

function personNameLookup(
  agents: Array<{ id: number; name: string }>,
  managers: Array<{ id: number; name: string }>,
) {
  const names = new Map<string, string>();
  for (const agent of agents) names.set(`agent:${agent.id}`, agent.name);
  for (const manager of managers) names.set(`account_manager:${manager.id}`, manager.name);
  return (kind: "agent" | "account_manager", id: number) => names.get(`${kind}:${id}`) ?? "Person";
}

function currentForPair(allocations: AllocationView[], groupId: number, lineOfBusinessId: number, asOfMonth: string) {
  return allocations
    .filter((row) => (
      row.groupId === groupId
      && row.lineOfBusinessId === lineOfBusinessId
      && row.status === "active"
      && row.effectiveStart <= asOfMonth
      && (row.effectiveEnd == null || row.effectiveEnd >= asOfMonth)
    ))
    .sort((left, right) => right.effectiveStart.localeCompare(left.effectiveStart) || left.id - right.id)[0] ?? null;
}

function targetFingerprint(allocation: AllocationView | null) {
  return allocation
    ? `${allocation.id}:${allocation.effectiveStart}:${allocation.effectiveEnd ?? ""}:${allocation.status}:${recipientFingerprint(allocation.entries)}`
    : "none";
}

async function resolveProposed(db: AppDatabase, input: BulkCompensationRequest) {
  if (input.targets.length === 0) throw new ValidationError("Select at least one Group and Line of Coverage.");
  const keys = input.targets.map((target) => `${target.groupId}:${target.lineOfBusinessId}`);
  if (new Set(keys).size !== keys.length) {
    throw new ValidationError("Each Group and Line of Coverage can be selected only once.");
  }
  const owner = await getAgencyOwnerForPaidMonth(db, input.effectiveStart);
  const team = input.mode === "template" && input.teamId != null ? await getTeam(db, input.teamId) : null;
  if (input.mode === "template" && !team) throw new ValidationError("Choose a compensation template.");
  try {
    const entries = resolveBulkProposedEntries({
      mode: input.mode,
      team,
      people: input.people,
      owner,
      effectiveStart: input.effectiveStart,
    });
    return { owner, team, entries };
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : "Invalid compensation split.");
  }
}

function bindTargets(
  input: BulkCompensationRequest,
  allocations: AllocationView[],
  groups: Array<{ id: number; name: string }>,
  lines: Array<{ id: number; name: string }>,
): BulkCompensationTarget[] {
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  return input.targets.map((target) => {
    const group = groupsById.get(target.groupId);
    const line = lines.find((item) => item.id === target.lineOfBusinessId);
    if (!group || !line) throw new ValidationError("A selected Group or Line of Coverage no longer exists.");
    const canonicalId = canonicalLineIdFor({ id: line.id, name: line.name }, lines);
    const current = currentForPair(allocations, target.groupId, canonicalId, input.effectiveStart)
      ?? currentForPair(allocations, target.groupId, target.lineOfBusinessId, input.effectiveStart);
    return {
      key: `${target.groupId}:${canonicalId}`,
      groupId: target.groupId,
      groupName: group.name,
      lineOfBusinessId: canonicalId,
      lineOfBusinessName: lines.find((item) => item.id === canonicalId)?.name ?? line.name,
      current: current ? {
        id: current.id,
        effectiveStart: current.effectiveStart,
        effectiveEnd: current.effectiveEnd,
        status: current.status,
        entries: current.entries,
      } : null,
    };
  });
}

function previewFromState(input: {
  effectiveStart: string;
  ownerKey: string | null;
  templateId: number | null;
  entries: AllocationEntryInput[];
  targets: BulkCompensationTarget[];
  proposedSummary: string;
  currentSummary: (entries: AllocationEntryInput[]) => string;
}) {
  const rows = planBulkCompensation({
    targets: input.targets,
    entries: input.entries,
    effectiveStart: input.effectiveStart,
    proposedSummary: input.proposedSummary,
    currentSummary: input.currentSummary,
  });
  const token = bulkCompensationPreviewToken({
    effectiveStart: input.effectiveStart,
    ownerKey: input.ownerKey,
    templateId: input.templateId,
    entries: input.entries,
    targets: input.targets.map((target) => ({
      groupId: target.groupId,
      lineOfBusinessId: target.lineOfBusinessId,
      currentId: target.current?.id ?? null,
      currentFingerprint: targetFingerprint(target.current ? {
        id: target.current.id,
        groupId: target.groupId,
        groupName: target.groupName,
        lineOfBusinessId: target.lineOfBusinessId,
        lineOfBusinessName: target.lineOfBusinessName,
        effectiveStart: target.current.effectiveStart,
        effectiveEnd: target.current.effectiveEnd,
        status: target.current.status,
        sourceAgreementId: null,
        createdAt: "",
        updatedAt: "",
        entries: target.current.entries.map((entry, index) => ({
          id: index,
          recipientType: entry.recipientType,
          personKind: entry.personKind ?? null,
          personId: entry.personId ?? null,
          personName: null,
          teamId: entry.teamId ?? null,
          teamName: null,
          compensationBps: entry.compensationBps,
          sortOrder: index,
        })),
      } : null),
    })),
  });
  return { rows, token };
}

export async function previewBulkCompensation(db: AppDatabase | undefined, input: BulkCompensationRequest) {
  const database = await resolveDb(db);
  const proposed = await resolveProposed(database, input);
  const allocations = await listAllocations(database);
  const groups = await listGroups(database);
  const lines = await listLinesOfBusiness(database);
  const agents = await listAgents(database);
  const managers = await listAccountManagers(database);
  const personName = personNameLookup(agents, managers);
  const currentSummary = (entries: AllocationEntryInput[]) => peopleFacingSummary(peopleFacingRecipients({
    entries,
    owner: proposed.owner,
    personName,
    ownerDisplayName: AGENCY_OWNER_DISPLAY_NAME,
  }));
  const proposedSummary = currentSummary(proposed.entries);
  const targets = bindTargets(input, allocations, groups, lines);
  const preview = previewFromState({
    effectiveStart: input.effectiveStart,
    ownerKey: proposed.owner ? personKey(proposed.owner) : null,
    templateId: proposed.team?.id ?? null,
    entries: proposed.entries,
    targets,
    proposedSummary,
    currentSummary,
  });
  return {
    previewToken: preview.token,
    effectiveStart: input.effectiveStart,
    groupCount: new Set(targets.map((target) => target.groupId)).size,
    targetCount: targets.length,
    proposedSummary,
    proposedPeople: peopleFacingRecipients({
      entries: proposed.entries,
      owner: proposed.owner,
      personName,
      ownerDisplayName: AGENCY_OWNER_DISPLAY_NAME,
    }),
    rows: preview.rows,
    closesCount: preview.rows.filter((row) => row.closePriorEnd).length,
    createCount: preview.rows.filter((row) => row.action === "create").length,
    versionCount: preview.rows.filter((row) => row.action === "version").length,
    reuseCount: preview.rows.filter((row) => row.action === "reuse").length,
    hasConflicts: bulkPreviewHasConflicts(preview.rows),
  };
}

export async function commitBulkCompensation(db: AppDatabase | undefined, input: BulkCompensationRequest) {
  if (!input.previewToken) throw new ValidationError("Preview the change before committing.");
  const database = await resolveDb(db);
  const proposed = await resolveProposed(database, input);
  const groups = await listGroups(database);
  const lines = await listLinesOfBusiness(database);
  const agents = await listAgents(database);
  const managers = await listAccountManagers(database);
  const personName = personNameLookup(agents, managers);
  const currentSummary = (entries: AllocationEntryInput[]) => peopleFacingSummary(peopleFacingRecipients({
    entries,
    owner: proposed.owner,
    personName,
    ownerDisplayName: AGENCY_OWNER_DISPLAY_NAME,
  }));
  const proposedSummary = currentSummary(proposed.entries);
  const period = { effectiveStart: input.effectiveStart, effectiveEnd: null as string | null };

  const result = await database.transaction(async (tx) => {
    const transaction = tx as unknown as AppDatabase;
    await lockAllocationNamespaces(transaction, input.targets);
    const allocations: AllocationView[] = [];
    for (const target of [...input.targets].sort((left, right) => (
      left.groupId - right.groupId || left.lineOfBusinessId - right.lineOfBusinessId
    ))) {
      allocations.push(...await listAllocationsForPair(transaction, target.groupId, target.lineOfBusinessId));
    }
    const targets = bindTargets(input, allocations, groups, lines);
    const preview = previewFromState({
      effectiveStart: input.effectiveStart,
      ownerKey: proposed.owner ? personKey(proposed.owner) : null,
      templateId: proposed.team?.id ?? null,
      entries: proposed.entries,
      targets,
      proposedSummary,
      currentSummary,
    });
    const exactReuse = preview.rows.every((row) => row.action === "reuse");
    if (preview.token !== input.previewToken) {
      if (exactReuse) {
        return { createdCount: 0, reusedCount: targets.length, rows: preview.rows, previewToken: preview.token };
      }
      throw new ConflictError(staleBulkPreviewMessage());
    }
    if (bulkPreviewHasConflicts(preview.rows)) {
      throw new ValidationError("One or more selected targets cannot be updated. Nothing was saved.");
    }
    const toWrite = targets.filter((_, index) => preview.rows[index]?.action !== "reuse").map((target) => ({
      write: {
        groupId: target.groupId,
        lineOfBusinessId: target.lineOfBusinessId,
        effectiveStart: input.effectiveStart,
        effectiveEnd: null,
        status: "active" as const,
        entries: proposed.entries,
      },
      period,
      status: "active" as const,
    }));
    const createdIds = await applyAllocationWrites(transaction, toWrite);
    return {
      createdCount: createdIds.length,
      reusedCount: targets.length - createdIds.length,
      rows: preview.rows,
      previewToken: preview.token,
    };
  });

  return {
    ...result,
    groupCount: new Set(input.targets.map((target) => target.groupId)).size,
    targetCount: input.targets.length,
    proposedSummary,
    effectiveStart: input.effectiveStart,
  };
}
