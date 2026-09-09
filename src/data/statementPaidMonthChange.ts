import { eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import {
  commissionPayouts,
  commissionRecords,
  importStatements,
  statementPaidMonthChanges,
} from "@/db/schema";
import { listCorrectedCommissionIds } from "./compensationCorrections";
import type { CorrectionInitiator } from "./compensationCorrections";
import { getCommission, type CommissionView } from "./commissions";
import { listPayoutsForCommission, type PayoutView } from "./payouts";
import { getImportStatement } from "./statements";
import { failIfTestHook } from "./transactionTestHook";
import { ConflictError, isUniqueConstraintError, NotFoundError, ValidationError } from "@/lib/errors";
import { isPaidMonth } from "@/domain/dates";
import {
  invariantStateAfterPaidMonthMove,
  paidMonthAuditClassification,
  paidMonthBoundState,
  paidMonthPreviewToken,
  paidMonthRequestFingerprint,
  stalePaidMonthPreviewMessage,
  type PaidMonthBoundPayout,
  type PaidMonthCommissionBind,
} from "@/domain/statementPaidMonthChange";

export type StatementPaidMonthPreview = {
  statementId: number;
  statementName: string;
  carrierName: string | null;
  currentPaidMonth: string;
  newPaidMonth: string;
  commissionCount: number;
  commissionIds: number[];
  grossAffectedCents: number;
  payoutCount: number;
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

type AssembledPlan = StatementPaidMonthPreview & {
  boundInvariant: string;
};

function commissionBind(commission: CommissionView, corrected: boolean): PaidMonthCommissionBind {
  return {
    id: commission.id,
    groupId: commission.groupId,
    carrierId: commission.carrierId,
    lineOfBusinessId: commission.lineOfBusinessId,
    grossCommissionCents: commission.grossCommissionCents,
    statementMonth: commission.statementMonth,
    premiumMonth: commission.premiumMonth,
    sourceCoverageLabel: commission.sourceCoverageLabel,
    sourceGroupLabel: commission.sourceGroupLabel,
    sourceLobLabel: commission.sourceLobLabel,
    sourcePeriodLabel: commission.sourcePeriodLabel,
    sourceReference: commission.sourceReference,
    sourceRowKey: commission.sourceRowKey,
    importStatementId: commission.importStatementId,
    agentId: commission.agentId,
    compensationBps: commission.compensationBps,
    agentCompensationCents: commission.agentCompensationCents,
    agencyNetCents: commission.agencyNetCents,
    corrected,
  };
}

function payoutBind(payout: PayoutView): PaidMonthBoundPayout {
  return {
    id: payout.id,
    commissionId: payout.commissionId,
    allocationId: payout.allocationId,
    recipientType: payout.recipientType,
    personKind: payout.personKind,
    personId: payout.personId,
    personName: payout.personName,
    teamId: payout.teamId,
    teamName: payout.teamName,
    parentPayoutId: payout.parentPayoutId,
    allocationBps: payout.allocationBps,
    teamInternalBps: payout.teamInternalBps,
    compensationCents: payout.compensationCents,
    createdAt: payout.createdAt,
  };
}

function preservedFinancially(before: CommissionView, after: CommissionView) {
  if (after.premiumMonth !== before.premiumMonth) {
    throw new ValidationError("Paid-month change cannot alter coverage/source month.");
  }
  if (after.grossCommissionCents !== before.grossCommissionCents) {
    throw new ValidationError("Paid-month change cannot alter gross commission.");
  }
  if (after.compensationBps !== before.compensationBps || after.agentCompensationCents !== before.agentCompensationCents) {
    throw new ValidationError("Paid-month change cannot alter compensation.");
  }
  if (after.agencyNetCents !== before.agencyNetCents) {
    throw new ValidationError("Paid-month change cannot alter Agency Net.");
  }
  if (after.groupId !== before.groupId || after.carrierId !== before.carrierId || after.lineOfBusinessId !== before.lineOfBusinessId) {
    throw new ValidationError("Paid-month change cannot alter Group, Carrier, or LOB.");
  }
  if (
    after.sourceCoverageLabel !== before.sourceCoverageLabel
    || after.sourceGroupLabel !== before.sourceGroupLabel
    || after.sourceLobLabel !== before.sourceLobLabel
    || after.sourcePeriodLabel !== before.sourcePeriodLabel
    || after.sourceReference !== before.sourceReference
  ) {
    throw new ValidationError("Paid-month change cannot alter source labels.");
  }
  if (after.sourceRowKey !== before.sourceRowKey || after.importStatementId !== before.importStatementId) {
    throw new ValidationError("Paid-month change cannot alter source identity.");
  }
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

async function lockPaidMonthSources(db: AppDatabase, statementId: number, commissions: CommissionView[]) {
  await db.select({ id: importStatements.id })
    .from(importStatements)
    .where(eq(importStatements.id, statementId))
    .for("update");
  const commissionIds = commissions.map((row) => row.id).sort((left, right) => left - right);
  if (commissionIds.length === 0) return;
  await db.select({ id: commissionRecords.id })
    .from(commissionRecords)
    .where(inArray(commissionRecords.id, commissionIds))
    .orderBy(commissionRecords.id)
    .for("update");
  await db.select({ id: commissionPayouts.id })
    .from(commissionPayouts)
    .where(inArray(commissionPayouts.commissionId, commissionIds))
    .orderBy(commissionPayouts.id)
    .for("update");
}

async function assemblePreview(
  db: AppDatabase,
  statementId: number,
  newPaidMonth: string,
): Promise<AssembledPlan> {
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
  const corrected = await listCorrectedCommissionIds(db);
  const payoutBinds: PaidMonthBoundPayout[] = [];
  for (const commission of commissions) {
    const payouts = await listPayoutsForCommission(db, commission.id);
    payoutBinds.push(...payouts.map(payoutBind));
  }
  const commissionBinds = commissions.map((commission) => commissionBind(commission, corrected.has(commission.id)));
  const bound = paidMonthBoundState({
    statementId: statement.id,
    currentPaidMonth: statement.paidMonth,
    newPaidMonth,
    commissions: commissionBinds,
    payouts: payoutBinds,
  });
  const commissionIds = commissions.map((row) => row.id);
  return {
    statementId: statement.id,
    statementName: statement.displayName,
    carrierName: statement.carrierName,
    currentPaidMonth: statement.paidMonth,
    newPaidMonth,
    commissionCount: commissions.length,
    commissionIds,
    grossAffectedCents: commissions.reduce((sum, row) => sum + row.grossCommissionCents, 0),
    payoutCount: payoutBinds.length,
    confirmable: true,
    payoutCorrectionRequired: false,
    previewToken: paidMonthPreviewToken(bound),
    boundInvariant: invariantStateAfterPaidMonthMove(bound),
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
  const { boundInvariant: _boundInvariant, ...preview } = await assemblePreview(await resolveDb(db), statementId, newPaidMonth);
  return preview;
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

      const unlocked = await commissionsForStatement(transaction, input.statementId);
      await lockPaidMonthSources(transaction, input.statementId, unlocked);

      const plan = await assemblePreview(transaction, input.statementId, input.newPaidMonth);
      if (plan.previewToken !== previewToken) {
        throw new ValidationError(stalePaidMonthPreviewMessage());
      }

      const commissionIds = plan.commissionIds;
      const now = new Date().toISOString();
      await transaction.update(importStatements).set({
        paidMonth: input.newPaidMonth,
        updatedAt: now,
      }).where(eq(importStatements.id, input.statementId));
      failIfTestHook("paid-month-after-statement");
      for (const commissionId of commissionIds) {
        const before = await getCommission(transaction, commissionId);
        if (!before) throw new ValidationError("Commission not found.");
        await transaction.update(commissionRecords).set({
          statementMonth: input.newPaidMonth,
          updatedAt: now,
        }).where(eq(commissionRecords.id, commissionId));
        const after = await getCommission(transaction, commissionId);
        if (!after) throw new ValidationError("Commission not found after paid-month change.");
        preservedFinancially(before, after);
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
        impactClassificationJson: JSON.stringify(paidMonthAuditClassification({ payoutCount: plan.payoutCount })),
        payoutCorrectionRequired: 0,
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
      if ([...moved.map((row) => row.id)].sort((left, right) => left - right).join(",") !== [...commissionIds].sort((left, right) => left - right).join(",")) {
        throw new ValidationError("Paid-month change failed post-condition validation.");
      }
      const afterPlan = await assemblePreview(transaction, input.statementId, plan.currentPaidMonth);
      if (afterPlan.boundInvariant !== plan.boundInvariant) {
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
