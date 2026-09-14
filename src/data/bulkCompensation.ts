import {
  bulkCompensationPreviewToken,
  bulkPreviewHasConflicts,
  planBulkCompensation,
  resolveBulkProposedEntries,
  siblingStateFingerprint,
  staleBulkPreviewMessage,
  templateStateFingerprint,
  type BulkCompensationTarget,
} from "@/domain/bulkCompensation";
import { peopleFacingRecipients, peopleFacingSummary } from "@/domain/personCompensationModel";
import { agencyOwnerForPaidMonth, personKey } from "@/domain/agencyOwner";
import { AGENCY_OWNER_DISPLAY_NAME } from "@/domain/agencyOwner";
import type { AllocationEntryInput } from "@/domain/allocations";
import { canonicalLockPairs, canonicalizeCompensationTargets } from "@/domain/canonicalLob";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { ConflictError, ValidationError } from "@/lib/errors";
import { listAgencyCompensationOwners } from "./agencyOwner";
import {
  applyAllocationWrites,
  listAllocations,
  listAllocationsForNamespaces,
  type AllocationView,
} from "./allocations";
import { lockAllocationNamespaces } from "./allocationNamespaceLock";
import { listGroups } from "./groups";
import { listLinesOfBusiness } from "./linesOfBusiness";
import { listAgents } from "./agents";
import { listAccountManagers } from "./accountManagers";
import { getTeam } from "./teams";

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

function coveringCurrent(allocations: AllocationView[], groupId: number, siblingLineIds: number[], asOfMonth: string) {
  return allocations
    .filter((row) => (
      row.groupId === groupId
      && siblingLineIds.includes(row.lineOfBusinessId)
      && row.status === "active"
      && row.effectiveStart <= asOfMonth
      && (row.effectiveEnd == null || row.effectiveEnd >= asOfMonth)
    ))
    .sort((left, right) => right.effectiveStart.localeCompare(left.effectiveStart) || left.id - right.id);
}

function bindCanonicalTargets(input: {
  request: BulkCompensationRequest;
  allocations: AllocationView[];
  groups: Array<{ id: number; name: string }>;
  lines: Array<{ id: number; name: string }>;
}): BulkCompensationTarget[] {
  if (input.request.targets.length === 0) {
    throw new ValidationError("Select at least one Group and Line of Coverage.");
  }
  let canonical;
  try {
    canonical = canonicalizeCompensationTargets(input.request.targets, input.lines);
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : "A selected Group or Line of Coverage no longer exists.");
  }
  const groupsById = new Map(input.groups.map((group) => [group.id, group]));
  return canonical.map((target) => {
    const group = groupsById.get(target.groupId);
    if (!group) throw new ValidationError("A selected Group or Line of Coverage no longer exists.");
    const siblings = input.allocations
      .filter((row) => row.groupId === target.groupId && target.siblingLineIds.includes(row.lineOfBusinessId))
      .map((row) => ({
        id: row.id,
        lineOfBusinessId: row.lineOfBusinessId,
        effectiveStart: row.effectiveStart,
        effectiveEnd: row.effectiveEnd,
        status: row.status,
        entries: row.entries,
      }));
    const covering = coveringCurrent(input.allocations, target.groupId, target.siblingLineIds, input.request.effectiveStart);
    return {
      key: target.key,
      groupId: target.groupId,
      groupName: group.name,
      lineOfBusinessId: target.canonicalLineId,
      lineOfBusinessName: target.canonicalLineName,
      siblingLineIds: target.siblingLineIds,
      siblings,
      current: covering.length === 1 ? {
        id: covering[0]!.id,
        lineOfBusinessId: covering[0]!.lineOfBusinessId,
        effectiveStart: covering[0]!.effectiveStart,
        effectiveEnd: covering[0]!.effectiveEnd,
        status: covering[0]!.status,
        entries: covering[0]!.entries,
      } : null,
    };
  });
}

function previewFromState(input: {
  effectiveStart: string;
  ownerKey: string | null;
  templateId: number | null;
  templateFingerprint: string;
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
    templateFingerprint: input.templateFingerprint,
    entries: input.entries,
    targets: input.targets.map((target) => ({
      groupId: target.groupId,
      lineOfBusinessId: target.lineOfBusinessId,
      siblingLineIds: target.siblingLineIds,
      siblingFingerprint: siblingStateFingerprint(target.siblings),
    })),
  });
  return { rows, token };
}

async function resolveProposedFromDb(
  db: AppDatabase,
  input: BulkCompensationRequest,
) {
  const owners = await listAgencyCompensationOwners(db);
  const owner = agencyOwnerForPaidMonth(owners.map((row) => ({
    identity: row.identity,
    effectiveStartMonth: row.effectiveStartMonth,
    effectiveEndMonth: row.effectiveEndMonth,
  })), input.effectiveStart);
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

export async function previewBulkCompensation(db: AppDatabase | undefined, input: BulkCompensationRequest) {
  const database = await resolveDb(db);
  const proposed = await resolveProposedFromDb(database, input);
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
  const targets = bindCanonicalTargets({ request: input, allocations, groups, lines });
  const preview = previewFromState({
    effectiveStart: input.effectiveStart,
    ownerKey: proposed.owner ? personKey(proposed.owner) : null,
    templateId: proposed.team?.id ?? null,
    templateFingerprint: templateStateFingerprint(proposed.team),
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
  const groups = await listGroups(database);
  const lines = await listLinesOfBusiness(database);
  const agents = await listAgents(database);
  const managers = await listAccountManagers(database);
  const personName = personNameLookup(agents, managers);
  const period = { effectiveStart: input.effectiveStart, effectiveEnd: null as string | null };
  let canonical;
  try {
    canonical = canonicalizeCompensationTargets(input.targets, lines);
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : "A selected Group or Line of Coverage no longer exists.");
  }
  const lockPairs = canonicalLockPairs(canonical);

  const result = await database.transaction(async (tx) => {
    const transaction = tx as unknown as AppDatabase;
    await lockAllocationNamespaces(transaction, lockPairs);
    const allocations = await listAllocationsForNamespaces(transaction, lockPairs);
    const proposed = await resolveProposedFromDb(transaction, input);
    const currentSummary = (entries: AllocationEntryInput[]) => peopleFacingSummary(peopleFacingRecipients({
      entries,
      owner: proposed.owner,
      personName,
      ownerDisplayName: AGENCY_OWNER_DISPLAY_NAME,
    }));
    const proposedSummary = currentSummary(proposed.entries);
    const targets = bindCanonicalTargets({ request: input, allocations, groups, lines });
    const preview = previewFromState({
      effectiveStart: input.effectiveStart,
      ownerKey: proposed.owner ? personKey(proposed.owner) : null,
      templateId: proposed.team?.id ?? null,
      templateFingerprint: templateStateFingerprint(proposed.team),
      entries: proposed.entries,
      targets,
      proposedSummary,
      currentSummary,
    });
    const exactReuse = preview.rows.every((row) => row.action === "reuse");
    if (preview.token !== input.previewToken) {
      if (exactReuse) {
        return {
          createdCount: 0,
          reusedCount: targets.length,
          rows: preview.rows,
          previewToken: preview.token,
          proposedSummary,
        };
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
      siblingPairs: target.siblingLineIds.map((lineOfBusinessId) => ({
        groupId: target.groupId,
        lineOfBusinessId,
      })),
    }));
    const createdIds = await applyAllocationWrites(transaction, toWrite);
    return {
      createdCount: createdIds.length,
      reusedCount: targets.length - createdIds.length,
      rows: preview.rows,
      previewToken: preview.token,
      proposedSummary,
    };
  });

  return {
    ...result,
    groupCount: new Set(canonical.map((target) => target.groupId)).size,
    targetCount: canonical.length,
    effectiveStart: input.effectiveStart,
  };
}
