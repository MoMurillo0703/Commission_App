import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { commissionRecords, importStatements, statementPaidMonthChanges } from "@/db/schema";
import { allocationCandidates, listAllocations } from "./allocations";
import { listCorrectedCommissionIds } from "./compensationCorrections";
import type { CorrectionInitiator } from "./compensationCorrections";
import { getCommission, type CommissionView } from "./commissions";
import { listPayoutsForCommission } from "./payouts";
import { getImportStatement } from "./statements";
import { ConflictError, isUniqueConstraintError, NotFoundError, ValidationError } from "@/lib/errors";
import { isPaidMonth } from "@/domain/dates";
import {
  classifyPaidMonthImpact,
  paidMonthImpactAllowsConfirm,
  paidMonthPreviewToken,
  paidMonthRequestFingerprint,
  PAID_MONTH_IMPACT,
  resolvePaidMonthAllocations,
  stalePaidMonthPreviewMessage,
  statementPayoutFingerprint,
  type PaidMonthImpactClass,
} from "@/domain/statementPaidMonthChange";

export type StatementPaidMonthImpactItem = {
  commissionId: number;
  groupName: string;
  carrierName: string;
  lineOfBusinessName: string;
  grossCommissionCents: number;
  coverageMonth: string | null;
  sourcePeriodLabel: string | null;
  payoutCount: number;
  impactClass: PaidMonthImpactClass;
  impactCode: string;
  oldAllocationId: number | null;
  newAllocationId: number | null;
  blockedReason: string | null;
};

export type StatementPaidMonthPreview = {
  statementId: number;
  statementName: string;
  carrierName: string | null;
  currentPaidMonth: string;
  newPaidMonth: string;
  commissionCount: number;
  commissionIds: number[];
  grossAffectedCents: number;
  recipientPayoutsAffected: number;
  historicalAllocationsAffected: number;
  reportsAffected: string[];
  items: StatementPaidMonthImpactItem[];
  confirmable: boolean;
  payoutCorrectionRequired: boolean;
  previewToken: string;
};

export type StatementPaidMonthChangeResult = {
  auditId: number;
  statementId: number;
  confirmationKey: string;
  previewToken: string;
  requestFingerprint: string;
  oldPaidMonth: string;
  newPaidMonth: string;
  commissionIds: number[];
  commissionCount: number;
  grossAffectedCents: number;
  payoutCorrectionRequired: boolean;
  payoutCorrectionPerformed: boolean;
  reason: string;
  initiator: CorrectionInitiator;
  createdAt: string;
  replayed: boolean;
};

function blockedReasonFor(impactClass: PaidMonthImpactClass) {
  if (impactClass === "different_terms") {
    return "The new paid month selects different compensation terms. Use historical compensation correction before moving this statement.";
  }
  if (impactClass === "no_allocation") {
    return "The new paid month has no valid allocation. Financial settlement is blocked until terms are resolved.";
  }
  return null;
}

async function commissionsForStatement(db: AppDatabase, statementId: number): Promise<CommissionView[]> {
  const rows = await db
    .select({ id: commissionRecords.id })
    .from(commissionRecords)
    .where(eq(commissionRecords.importStatementId, statementId));
  const commissions = [];
  for (const row of rows) {
    const commission = await getCommission(db, row.id);
    if (commission) commissions.push(commission);
  }
  return commissions.sort((left, right) => left.id - right.id);
}

async function assemblePreview(
  db: AppDatabase,
  statementId: number,
  newPaidMonth: string,
): Promise<StatementPaidMonthPreview> {
  if (!isPaidMonth(newPaidMonth)) throw new ValidationError("Enter a paid month as YYYY-MM.");
  const statement = await getImportStatement(db, statementId);
  if (!statement) throw new NotFoundError("Statement not found.");
  if (statement.status !== "posted" && statement.status !== "partially_posted") {
    throw new ValidationError("Paid month can only be changed on a posted statement.");
  }
  if (statement.paidMonth === newPaidMonth) {
    throw new ValidationError("Choose a different paid month.");
  }
  const commissions = await commissionsForStatement(db, statementId);
  if (commissions.length === 0) throw new ValidationError("This statement has no linked commissions to move.");
  if (commissions.some((row) => row.statementMonth !== statement.paidMonth)) {
    throw new ValidationError("Linked commissions do not all match the statement paid month.");
  }
  const allocations = allocationCandidates(await listAllocations(db));
  const corrected = await listCorrectedCommissionIds(db);
  const items: StatementPaidMonthImpactItem[] = [];
  let recipientPayoutsAffected = 0;
  const allocationIds = new Set<number>();
  for (const commission of commissions) {
    const payouts = await listPayoutsForCommission(db, commission.id);
    recipientPayoutsAffected += payouts.filter((payout) => payout.recipientType !== "team").length;
    const { oldAllocation, newAllocation } = resolvePaidMonthAllocations(
      allocations,
      { groupId: commission.groupId, lineOfBusinessId: commission.lineOfBusinessId },
      statement.paidMonth,
      newPaidMonth,
    );
    if (oldAllocation) allocationIds.add(oldAllocation.id);
    if (newAllocation) allocationIds.add(newAllocation.id);
    const impactClass = classifyPaidMonthImpact({
      payouts,
      corrected: corrected.has(commission.id),
      oldAllocation,
      newAllocation,
    });
    items.push({
      commissionId: commission.id,
      groupName: commission.groupName,
      carrierName: commission.carrierName,
      lineOfBusinessName: commission.lineOfBusinessName,
      grossCommissionCents: commission.grossCommissionCents,
      coverageMonth: commission.premiumMonth,
      sourcePeriodLabel: commission.sourcePeriodLabel,
      payoutCount: payouts.length,
      impactClass,
      impactCode: PAID_MONTH_IMPACT[impactClass],
      oldAllocationId: oldAllocation?.id ?? null,
      newAllocationId: newAllocation?.id ?? null,
      blockedReason: blockedReasonFor(impactClass),
    });
  }
  const commissionIds = commissions.map((row) => row.id);
  const grossAffectedCents = commissions.reduce((sum, row) => sum + row.grossCommissionCents, 0);
  const payoutFingerprint = statementPayoutFingerprint(
    await Promise.all(commissions.map(async (commission) => ({
      id: commission.id,
      payouts: await listPayoutsForCommission(db, commission.id),
    }))),
  );
  const confirmable = items.every((item) => paidMonthImpactAllowsConfirm(item.impactClass));
  return {
    statementId: statement.id,
    statementName: statement.displayName,
    carrierName: statement.carrierName,
    currentPaidMonth: statement.paidMonth,
    newPaidMonth,
    commissionCount: commissions.length,
    commissionIds,
    grossAffectedCents,
    recipientPayoutsAffected,
    historicalAllocationsAffected: allocationIds.size,
    reportsAffected: [
      `Agency ${statement.paidMonth} report`,
      `Agency ${newPaidMonth} report`,
      `Individual ${statement.paidMonth} pay statement`,
      `Individual ${newPaidMonth} pay statement`,
      `Team ${statement.paidMonth} report`,
      `Team ${newPaidMonth} report`,
    ],
    items,
    confirmable,
    payoutCorrectionRequired: items.some((item) => item.impactClass === "different_terms" || item.impactClass === "no_allocation"),
    previewToken: paidMonthPreviewToken({
      statementId: statement.id,
      currentPaidMonth: statement.paidMonth,
      newPaidMonth,
      commissionIds,
      grossAffectedCents,
      payoutFingerprint,
    }),
  };
}

async function getChangeByConfirmationKey(db: AppDatabase, confirmationKey: string) {
  const [row] = await db.select().from(statementPaidMonthChanges)
    .where(eq(statementPaidMonthChanges.confirmationKey, confirmationKey))
    .limit(1);
  if (!row) return null;
  return {
    auditId: row.id,
    statementId: row.statementId,
    confirmationKey: row.confirmationKey,
    previewToken: row.previewToken,
    requestFingerprint: row.requestFingerprint,
    oldPaidMonth: row.oldPaidMonth,
    newPaidMonth: row.newPaidMonth,
    commissionIds: JSON.parse(row.commissionIdsJson) as number[],
    commissionCount: row.commissionCount,
    grossAffectedCents: row.grossAffectedCents,
    payoutCorrectionRequired: row.payoutCorrectionRequired === 1,
    payoutCorrectionPerformed: row.payoutCorrectionPerformed === 1,
    reason: row.reason,
    initiator: {
      id: row.initiatorId,
      email: row.initiatorEmail,
      name: row.initiatorName,
    },
    createdAt: row.createdAt,
    replayed: true,
  } satisfies StatementPaidMonthChangeResult;
}

function replayOrConflict(existing: StatementPaidMonthChangeResult, requestFingerprint: string) {
  if (existing.requestFingerprint !== requestFingerprint) {
    throw new ConflictError("This confirmation key was already used for a different paid-month change.");
  }
  return existing;
}

export async function previewStatementPaidMonthChange(
  db: AppDatabase | undefined,
  statementId: number,
  newPaidMonth: string,
) {
  return assemblePreview(await resolveDb(db), statementId, newPaidMonth);
}

export async function confirmStatementPaidMonthChange(
  db: AppDatabase | undefined,
  input: {
    statementId: number;
    newPaidMonth: string;
    reason: string;
    confirmationKey: string;
    previewToken: string;
    initiator: CorrectionInitiator;
  },
): Promise<StatementPaidMonthChangeResult> {
  const database = await resolveDb(db);
  const reason = input.reason.trim();
  const confirmationKey = input.confirmationKey.trim();
  const previewToken = input.previewToken.trim();
  if (!reason) throw new ValidationError("A reason is required to change paid month.");
  if (!confirmationKey) throw new ValidationError("A confirmation key is required.");
  if (!previewToken) throw new ValidationError("Confirm the exact preview. Preview again if it is missing.");
  if (!isPaidMonth(input.newPaidMonth)) throw new ValidationError("Enter a paid month as YYYY-MM.");

  const incomingFingerprint = paidMonthRequestFingerprint({
    statementId: input.statementId,
    previewToken,
    newPaidMonth: input.newPaidMonth,
    reason,
  });
  const existing = await getChangeByConfirmationKey(database, confirmationKey);
  if (existing) return replayOrConflict(existing, incomingFingerprint);

  try {
    return await database.transaction(async (tx) => {
      const transaction = tx as unknown as AppDatabase;
      const replay = await getChangeByConfirmationKey(transaction, confirmationKey);
      if (replay) return replayOrConflict(replay, incomingFingerprint);

      await transaction.select({ id: importStatements.id })
        .from(importStatements)
        .where(eq(importStatements.id, input.statementId))
        .for("update");

      const plan = await assemblePreview(transaction, input.statementId, input.newPaidMonth);
      if (plan.previewToken !== previewToken) {
        throw new ValidationError(stalePaidMonthPreviewMessage());
      }
      if (!plan.confirmable) {
        throw new ValidationError(plan.items.find((item) => item.blockedReason)?.blockedReason
          ?? "This paid-month change is blocked until compensation impact is resolved.");
      }

      const commissionIds = plan.commissionIds;
      if (commissionIds.length > 0) {
        await transaction.select({ id: commissionRecords.id })
          .from(commissionRecords)
          .where(eq(commissionRecords.importStatementId, input.statementId))
          .for("update");
      }

      const now = new Date().toISOString();
      await transaction.update(importStatements).set({
        paidMonth: input.newPaidMonth,
        updatedAt: now,
      }).where(eq(importStatements.id, input.statementId));
      for (const commissionId of commissionIds) {
        const before = await getCommission(transaction, commissionId);
        if (!before) throw new ValidationError("Commission not found.");
        await transaction.update(commissionRecords).set({
          statementMonth: input.newPaidMonth,
          updatedAt: now,
        }).where(eq(commissionRecords.id, commissionId));
        const after = await getCommission(transaction, commissionId);
        if (!after) throw new ValidationError("Commission not found after paid-month change.");
        if (after.premiumMonth !== before.premiumMonth) {
          throw new ValidationError("Paid-month change cannot alter coverage/source month.");
        }
        if (after.grossCommissionCents !== before.grossCommissionCents) {
          throw new ValidationError("Paid-month change cannot alter gross commission.");
        }
        if (after.sourceRowKey !== before.sourceRowKey || after.importStatementId !== before.importStatementId) {
          throw new ValidationError("Paid-month change cannot alter source identity.");
        }
      }

      const [audit] = await transaction.insert(statementPaidMonthChanges).values({
        statementId: input.statementId,
        confirmationKey,
        previewToken,
        requestFingerprint: incomingFingerprint,
        oldPaidMonth: plan.currentPaidMonth,
        newPaidMonth: input.newPaidMonth,
        commissionIdsJson: JSON.stringify(commissionIds),
        commissionCount: plan.commissionCount,
        grossAffectedCents: plan.grossAffectedCents,
        impactClassificationJson: JSON.stringify(plan.items.map((item) => ({
          commissionId: item.commissionId,
          impactClass: item.impactClass,
          impactCode: item.impactCode,
        }))),
        payoutCorrectionRequired: plan.payoutCorrectionRequired ? 1 : 0,
        payoutCorrectionPerformed: 0,
        reason,
        initiatorId: input.initiator.id,
        initiatorEmail: input.initiator.email,
        initiatorName: input.initiator.name,
        createdAt: now,
      }).returning();

      const moved = await commissionsForStatement(transaction, input.statementId);
      if (moved.length !== commissionIds.length || moved.some((row) => row.statementMonth !== input.newPaidMonth)) {
        throw new ValidationError("Paid-month change failed post-condition validation.");
      }

      return {
        auditId: audit.id,
        statementId: input.statementId,
        confirmationKey,
        previewToken,
        requestFingerprint: incomingFingerprint,
        oldPaidMonth: plan.currentPaidMonth,
        newPaidMonth: input.newPaidMonth,
        commissionIds,
        commissionCount: plan.commissionCount,
        grossAffectedCents: plan.grossAffectedCents,
        payoutCorrectionRequired: false,
        payoutCorrectionPerformed: false,
        reason,
        initiator: input.initiator,
        createdAt: now,
        replayed: false,
      };
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const replay = await getChangeByConfirmationKey(database, confirmationKey);
      if (replay) return replayOrConflict(replay, incomingFingerprint);
      throw new ConflictError("This paid-month change was already confirmed.");
    }
    throw error;
  }
}
