import { eq, inArray } from "drizzle-orm";
import {
  previewCompensationBps,
  settleAllocation,
  type PersonKind,
} from "@/domain/allocations";
import {
  correctionPreviewItem,
  correctionPreviewTotals,
  correctablePreviewIds,
  historicalAllocationForPaidMonth,
  historicalAllocationState,
  missingAllocationBlockedMessage,
  newerAllocationBlockedMessage,
  proposedCorrectionSettlement,
  payoutAuditSnapshot,
  type CorrectionPreviewItem,
} from "@/domain/compensationCorrection";
import { classifyAgencyFallback } from "@/domain/compensationFallback";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import {
  commissionRecords,
  compensationCorrectionBatches,
  compensationCorrectionItems,
} from "@/db/schema";
import { ConflictError, ValidationError } from "@/lib/errors";
import { isUniqueConstraintError } from "@/lib/errors";
import { allocationCandidates, listAllocations } from "./allocations";
import { listAccountManagers } from "./accountManagers";
import { listAgents } from "./agents";
import { getCommission, listCommissions } from "./commissions";
import { listAllPayouts, listPayoutsForCommission, replaceCommissionPayouts, type PayoutView } from "./payouts";
import { currentTeamMembers, listTeams } from "./teams";

export type CorrectionInitiator = {
  id: string | null;
  email: string | null;
  name: string | null;
};

export type CompensationCorrectionBatchResult = {
  batchId: number;
  confirmationKey: string;
  reason: string;
  initiator: CorrectionInitiator;
  createdAt: string;
  commissionIds: number[];
  replayed: boolean;
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

export async function previewCompensationCorrection(
  db: AppDatabase | undefined,
  commissionIds: number[],
): Promise<{ items: CorrectionPreviewItem[]; totals: ReturnType<typeof correctionPreviewTotals>; correctableIds: number[] }> {
  const database = await resolveDb(db);
  const uniqueIds = [...new Set(commissionIds)].sort((left, right) => left - right);
  if (uniqueIds.length === 0) throw new ValidationError("Select at least one commission to preview.");
  const [commissions, payouts, allocations, corrected] = await Promise.all([
    listCommissions(database),
    listAllPayouts(database),
    listAllocations(database),
    listCorrectedCommissionIds(database),
  ]);
  const byId = new Map(commissions.map((row) => [row.id, row]));
  const payoutsByCommission = new Map<number, PayoutView[]>();
  for (const payout of payouts) {
    const current = payoutsByCommission.get(payout.commissionId) ?? [];
    current.push(payout);
    payoutsByCommission.set(payout.commissionId, current);
  }
  const candidates = allocationCandidates(allocations);
  const names = await personNameLookup(database);
  const items: CorrectionPreviewItem[] = [];

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
    const eligibility = classifyAgencyFallback(fallbackInput(commission, commissionPayouts, corrected));
    if (!eligibility.eligible) {
      items.push(correctionPreviewItem({
        commissionId: commission.id,
        paidMonth: commission.statementMonth,
        groupName: commission.groupName,
        carrierName: commission.carrierName,
        lineOfBusinessName: commission.lineOfBusinessName,
        grossCommissionCents: commission.grossCommissionCents,
        originalAgencyCents: commissionPayouts[0]?.compensationCents ?? 0,
        originalAgencyNetCents: commission.agencyNetCents,
        proposed: null,
        blockedReason: eligibility.reason,
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
    if (state === "newer_only" || !allocation) {
      items.push(correctionPreviewItem({
        commissionId: commission.id,
        paidMonth: commission.statementMonth,
        groupName: commission.groupName,
        carrierName: commission.carrierName,
        lineOfBusinessName: commission.lineOfBusinessName,
        grossCommissionCents: commission.grossCommissionCents,
        originalAgencyCents: commissionPayouts[0]!.compensationCents,
        originalAgencyNetCents: commission.agencyNetCents,
        proposed: null,
        blockedReason: state === "newer_only" ? newerAllocationBlockedMessage() : missingAllocationBlockedMessage(),
      }));
      continue;
    }
    const settled = settleAllocation(
      commission.grossCommissionCents,
      allocation.entries,
      await teamShareMap(database, commission.statementMonth),
      { agencyName: "Murillo Insurance", personName: names },
    );
    items.push(correctionPreviewItem({
      commissionId: commission.id,
      paidMonth: commission.statementMonth,
      groupName: commission.groupName,
      carrierName: commission.carrierName,
      lineOfBusinessName: commission.lineOfBusinessName,
      grossCommissionCents: commission.grossCommissionCents,
      originalAgencyCents: commissionPayouts[0]!.compensationCents,
      originalAgencyNetCents: commission.agencyNetCents,
      proposed: proposedCorrectionSettlement(settled, allocation),
      blockedReason: null,
    }));
  }

  return {
    items,
    totals: correctionPreviewTotals(items),
    correctableIds: correctablePreviewIds(items),
  };
}

export async function confirmCompensationCorrection(
  db: AppDatabase | undefined,
  input: {
    commissionIds: number[];
    reason: string;
    confirmationKey: string;
    initiator: CorrectionInitiator;
  },
): Promise<CompensationCorrectionBatchResult> {
  const database = await resolveDb(db);
  const reason = input.reason.trim();
  const confirmationKey = input.confirmationKey.trim();
  if (!reason) throw new ValidationError("A correction reason is required.");
  if (!confirmationKey) throw new ValidationError("A confirmation key is required.");
  const uniqueIds = [...new Set(input.commissionIds)].sort((left, right) => left - right);
  if (uniqueIds.length === 0) throw new ValidationError("Select at least one commission to correct.");

  const existing = await getBatchByConfirmationKey(database, confirmationKey);
  if (existing) return existing;

  try {
    return await database.transaction(async (tx) => {
      const transaction = tx as unknown as AppDatabase;
      const replay = await getBatchByConfirmationKey(transaction, confirmationKey);
      if (replay) return replay;

      await transaction
        .select({ id: commissionRecords.id })
        .from(commissionRecords)
        .where(inArray(commissionRecords.id, uniqueIds))
        .orderBy(commissionRecords.id)
        .for("update");

      const preview = await previewCompensationCorrection(transaction, uniqueIds);
      const failed = preview.items.filter((item) => item.blockedReason || !item.proposed);
      if (failed.length > 0) {
        throw new ValidationError(failed[0]?.blockedReason ?? "One or more commissions cannot be corrected. The batch was not applied.");
      }
      if (preview.correctableIds.length !== uniqueIds.length) {
        throw new ValidationError("One or more commissions cannot be corrected. The batch was not applied.");
      }

      const now = new Date().toISOString();
      const [batch] = await transaction.insert(compensationCorrectionBatches).values({
        confirmationKey,
        reason,
        initiatorId: input.initiator.id,
        initiatorEmail: input.initiator.email,
        initiatorName: input.initiator.name,
        createdAt: now,
      }).returning();

      const names = await personNameLookup(transaction);
      const allocations = allocationCandidates(await listAllocations(transaction));

      for (const item of preview.items) {
        const commission = await getCommission(transaction, item.commissionId);
        if (!commission) throw new ValidationError("Commission not found.");
        const payouts = await listPayoutsForCommission(transaction, item.commissionId);
        const corrected = await listCorrectedCommissionIds(transaction);
        const eligibility = classifyAgencyFallback(fallbackInput(commission, payouts, corrected));
        if (!eligibility.eligible) {
          throw new ValidationError(eligibility.reason ?? "Commission is not an eligible Agency fallback.");
        }
        const allocation = historicalAllocationForPaidMonth(allocations, {
          groupId: commission.groupId,
          lineOfBusinessId: commission.lineOfBusinessId,
          paidMonth: commission.statementMonth,
        });
        if (!allocation || allocation.id !== item.proposed?.allocationId) {
          throw new ValidationError("The historical allocation changed before confirmation. The batch was not applied.");
        }
        const settled = settleAllocation(
          commission.grossCommissionCents,
          allocation.entries,
          await teamShareMap(transaction, commission.statementMonth),
          { agencyName: "Murillo Insurance", personName: names },
        );
        if (commission.grossCommissionCents !== item.grossCommissionCents) {
          throw new ValidationError("Gross commission changed before confirmation. The batch was not applied.");
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
      if (replay) return replay;
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
