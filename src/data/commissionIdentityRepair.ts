import { and, eq, inArray } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { carrierGroupIdentities, commissionRecords, compensationAllocations, groups } from "@/db/schema";
import { rememberCarrierCoverageAlias } from "./carrierCoverage";
import { getCarrier } from "./carriers";
import { getCommission, listPostedSourceRowKeys, type CommissionView } from "./commissions";
import { getGroup } from "./groups";
import { getImportStatement } from "./statements";
import { getLineOfBusiness, listLinesOfBusiness } from "./linesOfBusiness";
import { listPayoutsForCommission, type PayoutView } from "./payouts";
import { listAllocations } from "./allocations";
import { repointCarrierGroupIdentity } from "./carrierGroupIdentities";
import {
  applyDeterministicCoverageMapping,
  DETERMINISTIC_ANTHEM_COVERAGE_CODES,
  deterministicCoverageFamily,
  isAnthemFamilyCarrier,
} from "@/domain/deterministicCoverage";
import { normalizeCoverageValue } from "@/domain/carrierCoverage";
import { sourceRowKey } from "@/domain/importRows";
import {
  assertPayoutSnapshotsUnchanged,
  payoutIdentitySnapshot,
  type PayoutIdentitySnapshot,
} from "@/domain/payoutSnapshot";
import type { StatementPreview } from "@/domain/workbook";
import { ValidationError, NotFoundError } from "@/lib/errors";

export const CANONICAL_HR_LABOR_GROUP_ID = 29;
export const ANTHEM_DETERMINISTIC_CODES = Object.keys(DETERMINISTIC_ANTHEM_COVERAGE_CODES).map((code) => code.toUpperCase());

type FrozenFinancials = {
  commission: CommissionView;
  payouts: PayoutIdentitySnapshot[];
};

function payoutSnapshots(payouts: PayoutView[]) {
  return payouts.map(payoutIdentitySnapshot);
}

async function frozenFinancials(db: AppDatabase, commissionId: number): Promise<FrozenFinancials> {
  const commission = await getCommission(db, commissionId);
  if (!commission) throw new NotFoundError("Commission record not found.");
  return {
    commission,
    payouts: payoutSnapshots(await listPayoutsForCommission(db, commissionId)),
  };
}

function assertIdentityRepairUnchanged(before: FrozenFinancials, after: FrozenFinancials) {
  if (before.commission.grossCommissionCents !== after.commission.grossCommissionCents) {
    throw new ValidationError("Repair refused because gross commission changed.");
  }
  if (before.commission.statementMonth !== after.commission.statementMonth) {
    throw new ValidationError("Repair refused because paid month changed.");
  }
  if (before.commission.premiumMonth !== after.commission.premiumMonth) {
    throw new ValidationError("Repair refused because coverage/source month changed.");
  }
  if (before.commission.agentCompensationCents !== after.commission.agentCompensationCents) {
    throw new ValidationError("Repair refused because posted compensation changed.");
  }
  if (before.commission.agencyNetCents !== after.commission.agencyNetCents) {
    throw new ValidationError("Repair refused because Agency Net changed.");
  }
  try {
    assertPayoutSnapshotsUnchanged(before.payouts, after.payouts);
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : "Repair refused because payout identity changed.");
  }
}

function findPreviewSourceRow(preview: StatementPreview | null | undefined, key: string) {
  for (const sheet of preview?.sheets ?? []) {
    for (const row of sheet.rows) {
      const identity = row.sourceIdentity ?? sourceRowKey(sheet.name, row.rowNumber);
      if (identity === key) return { sheet, row, identity };
    }
  }
  return null;
}

async function reconcileGroupAssignments(
  db: AppDatabase,
  sourceGroupId: number,
  canonicalGroupId: number,
) {
  const source = await getGroup(db, sourceGroupId);
  const canonical = await getGroup(db, canonicalGroupId);
  if (!source || !canonical) throw new NotFoundError("Group not found.");
  const next = {
    accountManagerId: canonical.accountManagerId ?? source.accountManagerId ?? null,
    primaryAgentId: canonical.primaryAgentId ?? source.primaryAgentId ?? null,
  };
  const copied = {
    accountManager: canonical.accountManagerId == null && source.accountManagerId != null,
    primaryAgent: canonical.primaryAgentId == null && source.primaryAgentId != null,
  };
  if (copied.accountManager || copied.primaryAgent) {
    await db.update(groups).set({
      ...next,
      updatedAt: new Date().toISOString(),
    }).where(eq(groups.id, canonicalGroupId));
  }
  return {
    copied,
    preservedCanonicalAccountManager: canonical.accountManagerId,
    preservedCanonicalPrimaryAgent: canonical.primaryAgentId,
    sourceAccountManagerId: source.accountManagerId,
    sourcePrimaryAgentId: source.primaryAgentId,
  };
}

async function allocationContext(db: AppDatabase, sourceGroupId: number, canonicalGroupId: number) {
  const rows = await listAllocations(db);
  return {
    sourceAllocationIds: rows.filter((row) => row.groupId === sourceGroupId).map((row) => row.id),
    canonicalAllocationIds: rows.filter((row) => row.groupId === canonicalGroupId).map((row) => row.id),
    transferred: false,
  };
}

export async function reassignCommissionsToCanonicalGroup(
  db: AppDatabase | undefined,
  input: { sourceGroupId: number; canonicalGroupId: number },
) {
  if (input.sourceGroupId === input.canonicalGroupId) {
    throw new ValidationError("Source group and canonical group must be different.");
  }
  const database = await resolveDb(db);
  const source = await getGroup(database, input.sourceGroupId);
  const canonical = await getGroup(database, input.canonicalGroupId);
  if (!source || !canonical) throw new NotFoundError("Group not found.");

  return database.transaction(async (tx) => {
    const transaction = tx as unknown as AppDatabase;
    const commissions = await transaction
      .select({ id: commissionRecords.id })
      .from(commissionRecords)
      .where(eq(commissionRecords.groupId, input.sourceGroupId));
    const before = await Promise.all(commissions.map((row) => frozenFinancials(transaction, row.id)));
    const allocationBefore = await allocationContext(transaction, input.sourceGroupId, input.canonicalGroupId);
    const now = new Date().toISOString();

    for (const row of commissions) {
      const current = before.find((item) => item.commission.id === row.id)?.commission;
      await transaction.update(commissionRecords).set({
        groupId: input.canonicalGroupId,
        sourceGroupLabel: current?.sourceGroupLabel || source.name,
        updatedAt: now,
      }).where(eq(commissionRecords.id, row.id));
    }

    const identities = await transaction
      .select()
      .from(carrierGroupIdentities)
      .where(eq(carrierGroupIdentities.groupId, input.sourceGroupId));
    for (const identity of identities) {
      await repointCarrierGroupIdentity(transaction, {
        carrierId: identity.carrierId,
        externalGroupNumber: identity.externalGroupNumber,
        groupId: input.canonicalGroupId,
      });
    }

    const assignments = await reconcileGroupAssignments(transaction, input.sourceGroupId, input.canonicalGroupId);
    const allocationAfter = await allocationContext(transaction, input.sourceGroupId, input.canonicalGroupId);
    if (JSON.stringify(allocationBefore.sourceAllocationIds) !== JSON.stringify(allocationAfter.sourceAllocationIds)) {
      throw new ValidationError("Repair refused because source allocations changed.");
    }
    if (JSON.stringify(allocationBefore.canonicalAllocationIds) !== JSON.stringify(allocationAfter.canonicalAllocationIds)) {
      throw new ValidationError("Repair refused because canonical allocations were transferred or rewritten.");
    }
    const leftoverAllocations = await transaction
      .select({ id: compensationAllocations.id })
      .from(compensationAllocations)
      .where(eq(compensationAllocations.groupId, input.sourceGroupId));
    if (leftoverAllocations.length !== allocationBefore.sourceAllocationIds.length) {
      throw new ValidationError("Repair refused because source allocations were moved.");
    }

    const after = await Promise.all(commissions.map((row) => frozenFinancials(transaction, row.id)));
    after.forEach((item, index) => assertIdentityRepairUnchanged(before[index]!, item));
    const remaining = await transaction.select({ id: commissionRecords.id }).from(commissionRecords).where(eq(commissionRecords.groupId, input.sourceGroupId));
    if (remaining.length > 0) throw new ValidationError("Source group still has commissions after reassignment.");
    return {
      canonicalGroupId: input.canonicalGroupId,
      sourceGroupId: input.sourceGroupId,
      commissionIds: commissions.map((row) => row.id),
      identityCount: identities.length,
      assignments,
      allocations: allocationAfter,
    };
  });
}

export async function repairHrLaborIdentity(
  db: AppDatabase | undefined,
  input: { sourceGroupId: number; canonicalGroupId?: number },
) {
  const canonicalGroupId = input.canonicalGroupId ?? CANONICAL_HR_LABOR_GROUP_ID;
  if (canonicalGroupId !== CANONICAL_HR_LABOR_GROUP_ID) {
    throw new ValidationError("H&R Labor must reconcile to Group 29.");
  }
  return reassignCommissionsToCanonicalGroup(db, {
    sourceGroupId: input.sourceGroupId,
    canonicalGroupId,
  });
}

export async function repairImportStatementLinkage(
  db: AppDatabase | undefined,
  input: { commissionId: number; importStatementId: number; sourceRowKey: string },
) {
  const database = await resolveDb(db);
  return database.transaction(async (tx) => {
    const transaction = tx as unknown as AppDatabase;
    const before = await frozenFinancials(transaction, input.commissionId);
    const statement = await getImportStatement(transaction, input.importStatementId);
    if (!statement) throw new NotFoundError("Import statement not found.");
    if (statement.paidMonth !== before.commission.statementMonth) {
      throw new ValidationError("Import linkage repair cannot change paid month.");
    }
    if (statement.carrierId != null && statement.carrierId !== before.commission.carrierId) {
      throw new ValidationError("Import linkage repair requires a matching carrier.");
    }
    if (before.commission.importStatementId && before.commission.importStatementId !== input.importStatementId) {
      throw new ValidationError("Commission is already linked to a different import statement.");
    }
    if (before.commission.sourceRowKey && before.commission.sourceRowKey !== input.sourceRowKey) {
      throw new ValidationError("Commission already has a different source-row key.");
    }
    const previewRow = findPreviewSourceRow(statement.preview, input.sourceRowKey);
    if (!previewRow) {
      throw new ValidationError("Source row is not on the target statement.");
    }
    const postedKeys = await listPostedSourceRowKeys(transaction, input.importStatementId);
    if (postedKeys.includes(input.sourceRowKey) && before.commission.sourceRowKey !== input.sourceRowKey) {
      throw new ValidationError("That import source-row key is already linked to another commission.");
    }

    await transaction.update(commissionRecords).set({
      importStatementId: input.importStatementId,
      sourceRowKey: input.sourceRowKey,
      updatedAt: new Date().toISOString(),
    }).where(eq(commissionRecords.id, input.commissionId));

    const after = await frozenFinancials(transaction, input.commissionId);
    assertIdentityRepairUnchanged(before, after);
    if (after.commission.groupId !== before.commission.groupId) {
      throw new ValidationError("Import linkage repair cannot change Group.");
    }
    if (after.commission.carrierId !== before.commission.carrierId) {
      throw new ValidationError("Import linkage repair cannot change Carrier.");
    }
    return after.commission;
  });
}

export async function rememberDeterministicCoverageAliases(
  db: AppDatabase | undefined,
  carrierId: number,
) {
  const database = await resolveDb(db);
  const carrier = await getCarrier(database, carrierId);
  if (!carrier || !isAnthemFamilyCarrier(carrier.name)) return [];
  const lines = await listLinesOfBusiness(database);
  const remembered = [];
  for (const sourceValue of ["MED", "MEDHMO", "DENPPO", "VIS"]) {
    const mapped = applyDeterministicCoverageMapping(
      { status: "unmatched", id: null, name: null, source: sourceValue },
      { carrierName: carrier.name, sourceValue, lines },
    );
    if (mapped.status !== "matched" || mapped.id == null) continue;
    remembered.push(await rememberCarrierCoverageAlias(database, {
      carrierId,
      sourceValue,
      lineOfBusinessId: mapped.id,
    }));
  }
  return remembered.filter(Boolean);
}

export async function normalizePostedAnthemCoverage(
  db: AppDatabase | undefined,
  input: { carrierId: number; commissionIds: number[]; importStatementId?: number | null },
) {
  if (input.commissionIds.length === 0) {
    throw new ValidationError("Anthem LOB repair requires an explicit commission set.");
  }
  const database = await resolveDb(db);
  const carrier = await getCarrier(database, input.carrierId);
  if (!carrier || !isAnthemFamilyCarrier(carrier.name)) {
    throw new ValidationError("Coverage normalization is limited to Anthem/Elevance carriers.");
  }
  const uniqueIds = [...new Set(input.commissionIds)].sort((left, right) => left - right);

  return database.transaction(async (tx) => {
    const transaction = tx as unknown as AppDatabase;
    const lines = await listLinesOfBusiness(transaction);
    const remapped: number[] = [];
    const commissions = await transaction
      .select({ id: commissionRecords.id })
      .from(commissionRecords)
      .where(and(
        inArray(commissionRecords.id, uniqueIds),
        eq(commissionRecords.carrierId, input.carrierId),
      ));
    if (commissions.length !== uniqueIds.length) {
      throw new ValidationError("Anthem LOB repair includes commissions that are not on the target Anthem carrier.");
    }
    for (const row of commissions) {
      const before = await frozenFinancials(transaction, row.id);
      if (input.importStatementId != null && before.commission.importStatementId !== input.importStatementId) {
        continue;
      }
      const rawCode = before.commission.sourceLobLabel
        || before.commission.sourceCoverageLabel
        || null;
      const normalized = normalizeCoverageValue(rawCode);
      if (!normalized || !(normalized in DETERMINISTIC_ANTHEM_COVERAGE_CODES)) continue;
      const family = deterministicCoverageFamily(carrier.name, rawCode);
      if (!family) continue;
      const mapped = applyDeterministicCoverageMapping(
        { status: "matched", id: before.commission.lineOfBusinessId, name: before.commission.lineOfBusinessName, source: rawCode },
        { carrierName: carrier.name, sourceValue: rawCode, lines },
      );
      if (mapped.status !== "matched" || mapped.id == null || mapped.id === before.commission.lineOfBusinessId) {
        if (!before.commission.sourceLobLabel && rawCode) {
          await transaction.update(commissionRecords).set({
            sourceLobLabel: rawCode,
            updatedAt: new Date().toISOString(),
          }).where(eq(commissionRecords.id, row.id));
        }
        continue;
      }
      if (!await getLineOfBusiness(transaction, mapped.id)) continue;
      await transaction.update(commissionRecords).set({
        lineOfBusinessId: mapped.id,
        sourceLobLabel: before.commission.sourceLobLabel || rawCode,
        updatedAt: new Date().toISOString(),
      }).where(eq(commissionRecords.id, row.id));
      const after = await frozenFinancials(transaction, row.id);
      assertIdentityRepairUnchanged(before, after);
      remapped.push(row.id);
    }
    await rememberDeterministicCoverageAliases(transaction, input.carrierId);
    return {
      remappedCommissionIds: remapped,
      mappings: {
        MED: "Group Medical",
        MEDHMO: "Group Medical",
        DENPPO: "Group Dental",
        VIS: "Group Vision",
      },
    };
  });
}
