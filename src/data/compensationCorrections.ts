import { eq, inArray } from "drizzle-orm";
import {
  previewCompensationBps,
  settleAllocation,
  type PersonKind,
} from "@/domain/allocations";
import {
  bindOriginalCorrectionState,
  correctionPreviewItem,
  correctionPreviewTotals,
  correctablePreviewIds,
  historicalAllocationForPaidMonth,
  historicalAllocationState,
  missingAllocationBlockedMessage,
  newerAllocationBlockedMessage,
  originalStatesMatch,
  proposedCorrectionSettlement,
  payoutAuditSnapshot,
  stalePreviewMessage,
  type CorrectionAuthorizedTerms,
  type CorrectionPreviewItem,
} from "@/domain/compensationCorrection";
import { correctionPreviewToken, correctionRequestFingerprint } from "@/domain/compensationCorrectionAuth";
import {
  classifyCorrectionSource,
  isCorrectableSourceClass,
  LEGACY_NO_PAYOUT_LABEL,
} from "@/domain/compensationFallback";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import {
  commissionRecords,
  compensationAllocationEntries,
  compensationAllocations,
  compensationCorrectionBatches,
  compensationCorrectionItems,
  teamMemberships,
} from "@/db/schema";
import { ConflictError, ValidationError, isUniqueConstraintError } from "@/lib/errors";
import { allocationCandidates, listAllocations, type AllocationView } from "./allocations";
import { listAccountManagers } from "./accountManagers";
import { listAgents } from "./agents";
import { getCommission, listCommissions, type CommissionView } from "./commissions";
import { listAllPayouts, listPayoutsForCommission, replaceCommissionPayouts, type PayoutView } from "./payouts";
import { currentTeamMembers, listTeams, type TeamView } from "./teams";

export type CorrectionInitiator = {
  id: string | null;
  email: string | null;
  name: string | null;
};

export type CompensationCorrectionBatchResult = {
  batchId: number;
  confirmationKey: string;
  previewToken: string;
  requestFingerprint: string;
  reason: string;
  initiator: CorrectionInitiator;
  createdAt: string;
  commissionIds: number[];
  replayed: boolean;
};

export type CompensationCorrectionPreview = {
  items: CorrectionPreviewItem[];
  totals: ReturnType<typeof correctionPreviewTotals>;
  correctableIds: number[];
  previewToken: string | null;
};

async function personNameLookup(db: AppDatabase) {
  const [agentRows, managerRows] = await Promise.all([listAgents(db), listAccountManagers(db)]);
  const names = new Map<string, string>([
    ...agentRows.map((agent) => [`agent:${agent.id}`, agent.name] as const),
    ...managerRows.map((manager) => [`account_manager:${manager.id}`, manager.name] as const),
  ]);
  return (kind: PersonKind, id: number) => names.get(`${kind}:${id}`) ?? "Person";
}

async function teamShareMap(db: AppDatabase, paidMonth: string) {
  const rows = await listTeams(db);
  return new Map(rows.map((team) => [team.id, {
    id: team.id,
    name: team.name,
    members: currentTeamMembers(team, paidMonth).map((member) => ({
      personKind: member.personKind,
      personId: member.personId,
      name: member.personName,
      shareBps: member.shareBps,
    })),
  }]));
}

function teamAuthorization(teams: TeamView[], teamIds: number[], paidMonth: string) {
  return teamIds.sort((left, right) => left - right).flatMap((teamId) => {
    const team = teams.find((row) => row.id === teamId);
    if (!team) return [];
    return [{
      teamId: team.id,
      members: currentTeamMembers(team, paidMonth).map((member) => ({
        personKind: member.personKind,
        personId: member.personId,
        shareBps: member.shareBps,
        effectiveStart: member.effectiveStart,
        effectiveEnd: member.effectiveEnd,
        status: member.status,
      })).sort((left, right) => (
        left.personKind.localeCompare(right.personKind) || left.personId - right.personId
      )),
    }];
  });
}

export async function listCorrectedCommissionIds(db?: AppDatabase) {
  const database = await resolveDb(db);
  const rows = await database.select({
    commissionId: compensationCorrectionItems.commissionId,
  }).from(compensationCorrectionItems);
  return new Set(rows.map((row) => row.commissionId));
}

function fallbackInput(
  commission: { id: number; grossCommissionCents: number; agentCompensationCents: number; agencyNetCents: number },
  payouts: PayoutView[],
  corrected: Set<number>,
) {
  return {
    commissionId: commission.id,
    grossCommissionCents: commission.grossCommissionCents,
    agentCompensationCents: commission.agentCompensationCents,
    agencyNetCents: commission.agencyNetCents,
    payouts,
    hasPriorCorrection: corrected.has(commission.id),
  };
}

async function getBatchByConfirmationKey(db: AppDatabase, confirmationKey: string) {
  const [batch] = await db.select().from(compensationCorrectionBatches)
    .where(eq(compensationCorrectionBatches.confirmationKey, confirmationKey))
    .limit(1);
  if (!batch) return null;
  const items = await db.select().from(compensationCorrectionItems)
    .where(eq(compensationCorrectionItems.batchId, batch.id));
  return {
    batchId: batch.id,
    confirmationKey: batch.confirmationKey,
    previewToken: batch.previewToken,
    requestFingerprint: batch.requestFingerprint,
    reason: batch.reason,
    initiator: {
      id: batch.initiatorId,
      email: batch.initiatorEmail,
      name: batch.initiatorName,
    },
    createdAt: batch.createdAt,
    commissionIds: items.map((item) => item.commissionId),
    replayed: true,
  } satisfies CompensationCorrectionBatchResult;
}

function replayOrConflict(
  existing: CompensationCorrectionBatchResult,
  requestFingerprint: string,
) {
  if (existing.requestFingerprint !== requestFingerprint) {
    throw new ConflictError("This confirmation key was already used for a different correction request.");
  }
  return existing;
}

async function lockCorrectionSources(
  db: AppDatabase,
  commissionIds: number[],
  allocationIds: number[],
  teamIds: number[],
) {
  if (commissionIds.length > 0) {
    await db.select({ id: commissionRecords.id })
      .from(commissionRecords)
      .where(inArray(commissionRecords.id, commissionIds))
      .orderBy(commissionRecords.id)
      .for("update");
  }
  if (allocationIds.length > 0) {
    await db.select({ id: compensationAllocations.id })
      .from(compensationAllocations)
      .where(inArray(compensationAllocations.id, allocationIds))
      .orderBy(compensationAllocations.id)
      .for("update");
    await db.select({ id: compensationAllocationEntries.id })
      .from(compensationAllocationEntries)
      .where(inArray(compensationAllocationEntries.allocationId, allocationIds))
      .orderBy(compensationAllocationEntries.id)
      .for("update");
  }
  if (teamIds.length > 0) {
    await db.select({ id: teamMemberships.id })
      .from(teamMemberships)
      .where(inArray(teamMemberships.teamId, teamIds))
      .orderBy(teamMemberships.id)
      .for("update");
  }
}

async function assembleCorrectionPlan(
  db: AppDatabase,
  commissionIds: number[],
): Promise<CompensationCorrectionPreview & { terms: CorrectionAuthorizedTerms }> {
  const uniqueIds = [...new Set(commissionIds)].sort((left, right) => left - right);
  if (uniqueIds.length === 0) throw new ValidationError("Select at least one commission to preview.");
  const [commissions, payouts, allocations, teams, corrected] = await Promise.all([
    listCommissions(db),
    listAllPayouts(db),
    listAllocations(db),
    listTeams(db),
    listCorrectedCommissionIds(db),
  ]);
  const byId = new Map(commissions.map((row) => [row.id, row]));
  const payoutsByCommission = new Map<number, PayoutView[]>();
  for (const payout of payouts) {
    const current = payoutsByCommission.get(payout.commissionId) ?? [];
    current.push(payout);
    payoutsByCommission.set(payout.commissionId, current);
  }
  const candidates = allocationCandidates(allocations);
  const names = await personNameLookup(db);
  const items: CorrectionPreviewItem[] = [];
  const authorized: CorrectionAuthorizedTerms = { commissions: [] };

  for (const commissionId of uniqueIds) {
    const commission = byId.get(commissionId);
    if (!commission) {
      items.push(correctionPreviewItem({
        commissionId,
        paidMonth: "",
        groupName: "",
        carrierName: "",
        lineOfBusinessName: "",
        grossCommissionCents: 0,
        originalAgencyCents: 0,
        originalAgencyNetCents: 0,
        proposed: null,
        blockedReason: "Commission not found.",
      }));
      continue;
    }
    const commissionPayouts = payoutsByCommission.get(commission.id) ?? [];
    const source = classifyCorrectionSource(fallbackInput(commission, commissionPayouts, corrected));
    const originalAgencyCents = commissionPayouts[0]?.compensationCents ?? 0;
    const originalLabel = source.class === "legacy_no_payout_snapshot"
      ? LEGACY_NO_PAYOUT_LABEL
      : "Agency 100%";
    const originalPreview = {
      originalAgencyCents,
      originalAgencyNetCents: commission.agencyNetCents,
      originalAgentCompensationCents: commission.agentCompensationCents,
      originalPayoutCount: commissionPayouts.length,
      originalLabel,
      sourceClass: source.class,
    };
    if (!isCorrectableSourceClass(source.class)) {
      items.push(correctionPreviewItem({
        commissionId: commission.id,
        paidMonth: commission.statementMonth,
        groupName: commission.groupName,
        carrierName: commission.carrierName,
        lineOfBusinessName: commission.lineOfBusinessName,
        grossCommissionCents: commission.grossCommissionCents,
        ...originalPreview,
        proposed: null,
        blockedReason: source.reason,
      }));
      continue;
    }
    const query = {
      groupId: commission.groupId,
      lineOfBusinessId: commission.lineOfBusinessId,
      paidMonth: commission.statementMonth,
    };
    const state = historicalAllocationState(candidates, query);
    const allocation = historicalAllocationForPaidMonth(candidates, query);
    const fullAllocation = allocation
      ? allocations.find((row) => row.id === allocation.id) ?? null
      : null;
    if (state === "newer_only" || !allocation || !fullAllocation) {
      items.push(correctionPreviewItem({
        commissionId: commission.id,
        paidMonth: commission.statementMonth,
        groupName: commission.groupName,
        carrierName: commission.carrierName,
        lineOfBusinessName: commission.lineOfBusinessName,
        grossCommissionCents: commission.grossCommissionCents,
        ...originalPreview,
        proposed: null,
        blockedReason: state === "newer_only" ? newerAllocationBlockedMessage() : missingAllocationBlockedMessage(),
      }));
      continue;
    }
    const settled = settleAllocation(
      commission.grossCommissionCents,
      allocation.entries,
      await teamShareMap(db, commission.statementMonth),
      { agencyName: "Murillo Insurance", personName: names },
    );
    items.push(correctionPreviewItem({
      commissionId: commission.id,
      paidMonth: commission.statementMonth,
      groupName: commission.groupName,
      carrierName: commission.carrierName,
      lineOfBusinessName: commission.lineOfBusinessName,
      grossCommissionCents: commission.grossCommissionCents,
      ...originalPreview,
      proposed: proposedCorrectionSettlement(settled, allocation),
      blockedReason: null,
    }));
    const teamIds = [...new Set(allocation.entries.flatMap((entry) => entry.teamId == null ? [] : [entry.teamId]))];
    authorized.commissions.push({
      commissionId: commission.id,
      paidMonth: commission.statementMonth,
      original: bindOriginalCorrectionState({
        sourceClass: source.class,
        commissionId: commission.id,
        paidMonth: commission.statementMonth,
        grossCommissionCents: commission.grossCommissionCents,
        agentCompensationCents: commission.agentCompensationCents,
        agencyNetCents: commission.agencyNetCents,
        payouts: commissionPayouts,
      }),
      allocation: {
        id: fullAllocation.id,
        groupId: fullAllocation.groupId,
        lineOfBusinessId: fullAllocation.lineOfBusinessId,
        effectiveStart: fullAllocation.effectiveStart,
        effectiveEnd: fullAllocation.effectiveEnd,
        status: fullAllocation.status,
        entries: fullAllocation.entries.map((entry) => ({
          recipientType: entry.recipientType,
          personKind: entry.personKind,
          personId: entry.personId,
          teamId: entry.teamId,
          compensationBps: entry.compensationBps,
        })).sort((left, right) => (
          left.recipientType.localeCompare(right.recipientType)
          || (left.personId ?? 0) - (right.personId ?? 0)
          || (left.teamId ?? 0) - (right.teamId ?? 0)
        )),
      },
      teams: teamAuthorization(teams, teamIds, commission.statementMonth),
      proposedPayouts: settled.payouts.map((payout) => ({
        recipientType: payout.recipientType,
        personKind: payout.personKind,
        personId: payout.personId,
        teamId: payout.teamId,
        allocationBps: payout.allocationBps,
        teamInternalBps: payout.teamInternalBps,
        compensationCents: payout.compensationCents,
      })),
      proposedAgentCompensationCents: settled.compensationDistributedCents,
      proposedAgencyNetCents: settled.agencyNetCents,
    });
  }

  const correctableIds = correctablePreviewIds(items);
  return {
    items,
    totals: correctionPreviewTotals(items),
    correctableIds,
    previewToken: authorized.commissions.length === uniqueIds.length ? correctionPreviewToken(authorized) : null,
    terms: authorized,
  };
}

function sourceIdsForPlan(commissions: CommissionView[], allocations: AllocationView[]) {
  const allocationIds = [...new Set(allocations.map((row) => row.id))];
  const teamIds = [...new Set(allocations.flatMap((row) => (
    row.entries.flatMap((entry) => entry.teamId == null ? [] : [entry.teamId])
  )))];
  return {
    commissionIds: commissions.map((row) => row.id),
    allocationIds,
    teamIds,
  };
}

export async function previewCompensationCorrection(
  db: AppDatabase | undefined,
  commissionIds: number[],
): Promise<CompensationCorrectionPreview> {
  const plan = await assembleCorrectionPlan(await resolveDb(db), commissionIds);
  return {
    items: plan.items,
    totals: plan.totals,
    correctableIds: plan.correctableIds,
    previewToken: plan.previewToken,
  };
}

export async function confirmCompensationCorrection(
  db: AppDatabase | undefined,
  input: {
    commissionIds: number[];
    reason: string;
    confirmationKey: string;
    previewToken: string;
    initiator: CorrectionInitiator;
  },
): Promise<CompensationCorrectionBatchResult> {
  const database = await resolveDb(db);
  const reason = input.reason.trim();
  const confirmationKey = input.confirmationKey.trim();
  const previewToken = input.previewToken.trim();
  if (!reason) throw new ValidationError("A correction reason is required.");
  if (!confirmationKey) throw new ValidationError("A confirmation key is required.");
  if (!previewToken) throw new ValidationError("Confirm the exact preview. Preview again if it is missing.");
  const uniqueIds = [...new Set(input.commissionIds)].sort((left, right) => left - right);
  if (uniqueIds.length === 0) throw new ValidationError("Select at least one commission to correct.");

  const incomingFingerprint = correctionRequestFingerprint({
    commissionIds: uniqueIds,
    previewToken,
    reason,
    termsHash: previewToken,
  });
  const existing = await getBatchByConfirmationKey(database, confirmationKey);
  if (existing) return replayOrConflict(existing, incomingFingerprint);

  try {
    return await database.transaction(async (tx) => {
      const transaction = tx as unknown as AppDatabase;
      const replay = await getBatchByConfirmationKey(transaction, confirmationKey);
      if (replay) return replayOrConflict(replay, incomingFingerprint);

      const commissions = (await listCommissions(transaction)).filter((row) => uniqueIds.includes(row.id));
      const allocations = await listAllocations(transaction);
      const pairKeys = new Set(commissions.map((row) => `${row.groupId}:${row.lineOfBusinessId}`));
      const pairAllocations = allocations.filter((row) => pairKeys.has(`${row.groupId}:${row.lineOfBusinessId}`));
      const sources = sourceIdsForPlan(commissions, pairAllocations);
      await lockCorrectionSources(transaction, uniqueIds, sources.allocationIds, sources.teamIds);

      const plan = await assembleCorrectionPlan(transaction, uniqueIds);
      const incomingLooksBound = /^[a-f0-9]{64}$/i.test(previewToken);
      if (plan.previewToken !== previewToken && (plan.previewToken != null || incomingLooksBound)) {
        throw new ValidationError(stalePreviewMessage());
      }
      const failed = plan.items.filter((item) => item.blockedReason || !item.proposed);
      if (failed.length > 0 || plan.correctableIds.length !== uniqueIds.length || !plan.previewToken) {
        throw new ValidationError(failed[0]?.blockedReason ?? "One or more commissions cannot be corrected. The batch was not applied.");
      }

      const now = new Date().toISOString();
      const [batch] = await transaction.insert(compensationCorrectionBatches).values({
        confirmationKey,
        previewToken,
        requestFingerprint: incomingFingerprint,
        reason,
        initiatorId: input.initiator.id,
        initiatorEmail: input.initiator.email,
        initiatorName: input.initiator.name,
        createdAt: now,
      }).returning();

      const names = await personNameLookup(transaction);
      const lockedAllocations = allocationCandidates(await listAllocations(transaction));

      for (const item of plan.items) {
        const commission = await getCommission(transaction, item.commissionId);
        if (!commission) throw new ValidationError("Commission not found.");
        const payouts = await listPayoutsForCommission(transaction, item.commissionId);
        const corrected = await listCorrectedCommissionIds(transaction);
        const source = classifyCorrectionSource(fallbackInput(commission, payouts, corrected));
        if (!isCorrectableSourceClass(source.class)) {
          throw new ValidationError(source.reason ?? "Commission is not an eligible correction source.");
        }
        const authorized = plan.terms.commissions.find((row) => row.commissionId === commission.id);
        const currentOriginal = bindOriginalCorrectionState({
          sourceClass: source.class,
          commissionId: commission.id,
          paidMonth: commission.statementMonth,
          grossCommissionCents: commission.grossCommissionCents,
          agentCompensationCents: commission.agentCompensationCents,
          agencyNetCents: commission.agencyNetCents,
          payouts,
        });
        if (!authorized || !originalStatesMatch(authorized.original, currentOriginal)) {
          throw new ValidationError(stalePreviewMessage());
        }
        const allocation = historicalAllocationForPaidMonth(lockedAllocations, {
          groupId: commission.groupId,
          lineOfBusinessId: commission.lineOfBusinessId,
          paidMonth: commission.statementMonth,
        });
        if (!authorized || !allocation || allocation.id !== authorized.allocation.id || allocation.id !== item.proposed?.allocationId) {
          throw new ValidationError(stalePreviewMessage());
        }
        const settled = settleAllocation(
          commission.grossCommissionCents,
          allocation.entries,
          await teamShareMap(transaction, commission.statementMonth),
          { agencyName: "Murillo Insurance", personName: names },
        );
        if (
          commission.grossCommissionCents !== item.grossCommissionCents
          || settled.compensationDistributedCents !== authorized.proposedAgentCompensationCents
          || settled.agencyNetCents !== authorized.proposedAgencyNetCents
        ) {
          throw new ValidationError(stalePreviewMessage());
        }

        await transaction.insert(compensationCorrectionItems).values({
          batchId: batch.id,
          commissionId: commission.id,
          paidMonth: commission.statementMonth,
          allocationId: allocation.id,
          originalPayoutsJson: JSON.stringify(payoutAuditSnapshot(payouts)),
          originalAgentCompensationCents: commission.agentCompensationCents,
          originalAgencyNetCents: commission.agencyNetCents,
          originalGrossCommissionCents: commission.grossCommissionCents,
          correctedPayoutsJson: JSON.stringify(payoutAuditSnapshot(settled.payouts.map((payout) => ({
            recipientType: payout.recipientType,
            personKind: payout.personKind,
            personId: payout.personId,
            personName: payout.personName,
            teamId: payout.teamId,
            teamName: payout.teamName,
            allocationId: allocation.id,
            allocationBps: payout.allocationBps,
            teamInternalBps: payout.teamInternalBps,
            compensationCents: payout.compensationCents,
          })))),
          correctedAgentCompensationCents: settled.compensationDistributedCents,
          correctedAgencyNetCents: settled.agencyNetCents,
          createdAt: now,
        });

        await replaceCommissionPayouts(transaction, commission.id, settled.payouts, allocation.id);
        await transaction.update(commissionRecords).set({
          agentCompensationCents: settled.compensationDistributedCents,
          agencyNetCents: settled.agencyNetCents,
          compensationBps: commission.agentId ? previewCompensationBps(settled, commission.agentId) : null,
          updatedAt: now,
        }).where(eq(commissionRecords.id, commission.id));
      }

      return {
        batchId: batch.id,
        confirmationKey,
        previewToken,
        requestFingerprint: incomingFingerprint,
        reason,
        initiator: input.initiator,
        createdAt: now,
        commissionIds: uniqueIds,
        replayed: false,
      };
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const replay = await getBatchByConfirmationKey(database, confirmationKey);
      if (replay) return replayOrConflict(replay, incomingFingerprint);
      throw new ConflictError("One or more commissions were already corrected. The batch was not applied.");
    }
    throw error;
  }
}

export async function listCorrectionAuditForCommission(db: AppDatabase | undefined, commissionId: number) {
  const database = await resolveDb(db);
  return database.select().from(compensationCorrectionItems)
    .where(eq(compensationCorrectionItems.commissionId, commissionId));
}
