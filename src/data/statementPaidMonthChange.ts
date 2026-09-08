import { and, eq, inArray, or } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import {
  commissionPayouts,
  commissionRecords,
  compensationAllocationEntries,
  compensationAllocations,
  importStatements,
  statementPaidMonthChanges,
  teamMemberships,
  teams,
} from "@/db/schema";
import { allocationCandidates, listAllocations, type AllocationView } from "./allocations";
import { listCorrectedCommissionIds } from "./compensationCorrections";
import type { CorrectionInitiator } from "./compensationCorrections";
import { getCommission, type CommissionView } from "./commissions";
import { listPayoutsForCommission } from "./payouts";
import { getImportStatement } from "./statements";
import { currentTeamMembers, listTeams, type TeamView } from "./teams";
import { failIfTestHook } from "./transactionTestHook";
import { ConflictError, isUniqueConstraintError, NotFoundError, ValidationError } from "@/lib/errors";
import { isPaidMonth } from "@/domain/dates";
import {
  classifyPaidMonthImpact,
  invariantStateAfterPaidMonthMove,
  paidMonthBoundState,
  paidMonthImpactAllowsConfirm,
  paidMonthPreviewToken,
  paidMonthRequestFingerprint,
  PAID_MONTH_IMPACT,
  resolvePaidMonthAllocations,
  stalePaidMonthPreviewMessage,
  type PaidMonthAllocationBind,
  type PaidMonthCommissionBind,
  type PaidMonthImpactClass,
  type PaidMonthTeamMembershipBind,
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

type AssembledPlan = StatementPaidMonthPreview & {
  boundInvariant: string;
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

function allocationBind(row: AllocationView): PaidMonthAllocationBind {
  return {
    id: row.id,
    groupId: row.groupId,
    lineOfBusinessId: row.lineOfBusinessId,
    effectiveStart: row.effectiveStart,
    effectiveEnd: row.effectiveEnd,
    status: row.status,
    entries: row.entries.map((entry) => ({
      id: entry.id,
      recipientType: entry.recipientType,
      personKind: entry.personKind,
      personId: entry.personId,
      teamId: entry.teamId,
      compensationBps: entry.compensationBps,
    })),
  };
}

function teamBinds(teamRows: TeamView[], paidMonth: string, teamIds: number[]): PaidMonthTeamMembershipBind[] {
  return teamRows
    .filter((team) => teamIds.includes(team.id))
    .flatMap((team) => currentTeamMembers(team, paidMonth).map((member) => ({
      teamId: team.id,
      membershipId: member.id,
      personKind: member.personKind,
      personId: member.personId,
      shareBps: member.shareBps,
      effectiveStart: member.effectiveStart,
      effectiveEnd: member.effectiveEnd,
      status: member.status,
    })));
}

function teamIdsFromAllocations(allocations: Array<{ entries: Array<{ teamId?: number | null }> }>) {
  return [...new Set(allocations.flatMap((allocation) => (
    allocation.entries.flatMap((entry) => (entry.teamId != null ? [entry.teamId] : []))
  )))].sort((left, right) => left - right);
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

async function lockTeams(db: AppDatabase, teamIds: number[]) {
  const unique = [...new Set(teamIds)].sort((left, right) => left - right);
  if (unique.length === 0) return;
  await db.select({ id: teams.id })
    .from(teams)
    .where(inArray(teams.id, unique))
    .orderBy(teams.id)
    .for("update");
  await db.select({ id: teamMemberships.id })
    .from(teamMemberships)
    .where(inArray(teamMemberships.teamId, unique))
    .orderBy(teamMemberships.id)
    .for("update");
}

async function lockPaidMonthSources(db: AppDatabase, statementId: number, commissions: CommissionView[]) {
  await db.select({ id: importStatements.id })
    .from(importStatements)
    .where(eq(importStatements.id, statementId))
    .for("update");
  const commissionIds = commissions.map((row) => row.id).sort((left, right) => left - right);
  const payoutTeamIds: number[] = [];
  if (commissionIds.length > 0) {
    await db.select({ id: commissionRecords.id })
      .from(commissionRecords)
      .where(inArray(commissionRecords.id, commissionIds))
      .orderBy(commissionRecords.id)
      .for("update");
    const payoutRows = await db.select({ id: commissionPayouts.id, teamId: commissionPayouts.teamId })
      .from(commissionPayouts)
      .where(inArray(commissionPayouts.commissionId, commissionIds))
      .orderBy(commissionPayouts.id)
      .for("update");
    payoutTeamIds.push(...payoutRows.flatMap((row) => (row.teamId != null ? [row.teamId] : [])));
  }
  const pairClauses = commissions.map((row) => and(
    eq(compensationAllocations.groupId, row.groupId),
    eq(compensationAllocations.lineOfBusinessId, row.lineOfBusinessId),
  ));
  const allocationTeamIds: number[] = [];
  if (pairClauses.length > 0) {
    const allocationRows = await db.select({ id: compensationAllocations.id })
      .from(compensationAllocations)
      .where(or(...pairClauses))
      .orderBy(compensationAllocations.id)
      .for("update");
    const allocationIds = allocationRows.map((row) => row.id);
    if (allocationIds.length > 0) {
      const entryRows = await db.select({
        id: compensationAllocationEntries.id,
        teamId: compensationAllocationEntries.teamId,
      })
        .from(compensationAllocationEntries)
        .where(inArray(compensationAllocationEntries.allocationId, allocationIds))
        .orderBy(compensationAllocationEntries.id)
        .for("update");
      allocationTeamIds.push(...entryRows.flatMap((row) => (row.teamId != null ? [row.teamId] : [])));
    }
  }
  await lockTeams(db, [...payoutTeamIds, ...allocationTeamIds]);
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
  const allocationRows = await listAllocations(db);
  const allocations = allocationCandidates(allocationRows);
  const teamRows = await listTeams(db);
  const corrected = await listCorrectedCommissionIds(db);
  const items: StatementPaidMonthImpactItem[] = [];
  let recipientPayoutsAffected = 0;
  const allocationIds = new Set<number>();
  const relevantAllocations: PaidMonthAllocationBind[] = [];
  const payoutBinds = [];
  for (const commission of commissions) {
    const payouts = await listPayoutsForCommission(db, commission.id);
    payoutBinds.push(...payouts.map((payout) => ({ ...payout, commissionId: commission.id })));
    recipientPayoutsAffected += payouts.filter((payout) => payout.recipientType !== "team").length;
    const { oldAllocation, newAllocation } = resolvePaidMonthAllocations(
      allocations,
      { groupId: commission.groupId, lineOfBusinessId: commission.lineOfBusinessId },
      statement.paidMonth,
      newPaidMonth,
    );
    const pairAllocations = allocationRows.filter((row) => (
      row.groupId === commission.groupId && row.lineOfBusinessId === commission.lineOfBusinessId
    ));
    pairAllocations.forEach((row) => {
      if (!relevantAllocations.some((item) => item.id === row.id)) relevantAllocations.push(allocationBind(row));
    });
    if (oldAllocation) allocationIds.add(oldAllocation.id);
    if (newAllocation) allocationIds.add(newAllocation.id);
    const compared = [oldAllocation, newAllocation].flatMap((item) => (item ? [item] : []));
    const teamIds = teamIdsFromAllocations(compared);
    const currentTeamMemberships = teamBinds(teamRows, statement.paidMonth, teamIds);
    const proposedTeamMemberships = teamBinds(teamRows, newPaidMonth, teamIds);
    const impactClass = classifyPaidMonthImpact({
      payouts,
      corrected: corrected.has(commission.id),
      oldAllocation,
      newAllocation,
      currentTeamMemberships,
      proposedTeamMemberships,
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
  const commissionBinds: PaidMonthCommissionBind[] = commissions.map((commission) => ({
    id: commission.id,
    groupId: commission.groupId,
    carrierId: commission.carrierId,
    lineOfBusinessId: commission.lineOfBusinessId,
    grossCommissionCents: commission.grossCommissionCents,
    statementMonth: commission.statementMonth,
    premiumMonth: commission.premiumMonth,
    sourceGroupLabel: commission.sourceGroupLabel,
    sourceLobLabel: commission.sourceLobLabel,
    sourcePeriodLabel: commission.sourcePeriodLabel,
    sourceReference: commission.sourceReference,
    sourceRowKey: commission.sourceRowKey,
    importStatementId: commission.importStatementId,
    corrected: corrected.has(commission.id),
  }));
  const allTeamIds = teamIdsFromAllocations(relevantAllocations);
  const bound = paidMonthBoundState({
    statementId: statement.id,
    currentPaidMonth: statement.paidMonth,
    newPaidMonth,
    commissions: commissionBinds,
    payouts: payoutBinds,
    allocations: relevantAllocations,
    currentTeamMemberships: teamBinds(teamRows, statement.paidMonth, allTeamIds),
    proposedTeamMemberships: teamBinds(teamRows, newPaidMonth, allTeamIds),
  });
  const commissionIds = commissions.map((row) => row.id);
  const confirmable = items.every((item) => paidMonthImpactAllowsConfirm(item.impactClass));
  return {
    statementId: statement.id,
    statementName: statement.displayName,
    carrierName: statement.carrierName,
    currentPaidMonth: statement.paidMonth,
    newPaidMonth,
    commissionCount: commissions.length,
    commissionIds,
    grossAffectedCents: commissions.reduce((sum, row) => sum + row.grossCommissionCents, 0),
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
      if (!plan.confirmable) {
        throw new ValidationError(plan.items.find((item) => item.blockedReason)?.blockedReason
          ?? "This paid-month change is blocked until compensation impact is resolved.");
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
        if (after.premiumMonth !== before.premiumMonth) {
          throw new ValidationError("Paid-month change cannot alter coverage/source month.");
        }
        if (after.grossCommissionCents !== before.grossCommissionCents) {
          throw new ValidationError("Paid-month change cannot alter gross commission.");
        }
        if (after.groupId !== before.groupId || after.carrierId !== before.carrierId || after.lineOfBusinessId !== before.lineOfBusinessId) {
          throw new ValidationError("Paid-month change cannot alter Group, Carrier, or LOB.");
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
