import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { carrierGroupIdentities, commissionRecords } from "@/db/schema";
import { rememberCarrierCoverageAlias } from "./carrierCoverage";
import { getCarrier } from "./carriers";
import { getCommission, listPostedSourceRowKeys } from "./commissions";
import { getGroup } from "./groups";
import { getImportStatement } from "./statements";
import { getLineOfBusiness, listLinesOfBusiness } from "./linesOfBusiness";
import { listPayoutsForCommission } from "./payouts";
import { repointCarrierGroupIdentity } from "./carrierGroupIdentities";
import {
  applyDeterministicCoverageMapping,
  deterministicCoverageFamily,
  isAnthemFamilyCarrier,
} from "@/domain/deterministicCoverage";
import { ValidationError, NotFoundError } from "@/lib/errors";

async function frozenFinancials(db: AppDatabase, commissionId: number) {
  const commission = await getCommission(db, commissionId);
  if (!commission) throw new NotFoundError("Commission record not found.");
  const payouts = await listPayoutsForCommission(db, commissionId);
  return {
    commission,
    payouts: payouts.map((row) => ({
      id: row.id,
      recipientType: row.recipientType,
      compensationCents: row.compensationCents,
    })),
  };
}

function assertFinancialsUnchanged(
  before: Awaited<ReturnType<typeof frozenFinancials>>,
  after: Awaited<ReturnType<typeof frozenFinancials>>,
) {
  if (before.commission.grossCommissionCents !== after.commission.grossCommissionCents) {
    throw new ValidationError("Repair refused because gross commission changed.");
  }
  if (before.commission.statementMonth !== after.commission.statementMonth) {
    throw new ValidationError("Repair refused because paid month changed.");
  }
  if (before.commission.agentCompensationCents !== after.commission.agentCompensationCents) {
    throw new ValidationError("Repair refused because posted compensation changed.");
  }
  if (before.payouts.length !== after.payouts.length) {
    throw new ValidationError("Repair refused because payout history changed.");
  }
  for (const [index, payout] of before.payouts.entries()) {
    if (payout.compensationCents !== after.payouts[index]?.compensationCents) {
      throw new ValidationError("Repair refused because payout history changed.");
    }
  }
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

  const commissions = await database
    .select({ id: commissionRecords.id })
    .from(commissionRecords)
    .where(eq(commissionRecords.groupId, input.sourceGroupId));
  const before = await Promise.all(commissions.map((row) => frozenFinancials(database, row.id)));
  const now = new Date().toISOString();

  for (const row of commissions) {
    const current = before.find((item) => item.commission.id === row.id)?.commission;
    await database.update(commissionRecords).set({
      groupId: input.canonicalGroupId,
      sourceGroupLabel: current?.sourceGroupLabel || source.name,
      updatedAt: now,
    }).where(eq(commissionRecords.id, row.id));
  }

  const identities = await database
    .select()
    .from(carrierGroupIdentities)
    .where(eq(carrierGroupIdentities.groupId, input.sourceGroupId));
  for (const identity of identities) {
    await repointCarrierGroupIdentity(database, {
      carrierId: identity.carrierId,
      externalGroupNumber: identity.externalGroupNumber,
      groupId: input.canonicalGroupId,
    });
  }

  const after = await Promise.all(commissions.map((row) => frozenFinancials(database, row.id)));
  after.forEach((item, index) => assertFinancialsUnchanged(before[index]!, item));
  const remaining = await database.select({ id: commissionRecords.id }).from(commissionRecords).where(eq(commissionRecords.groupId, input.sourceGroupId));
  if (remaining.length > 0) throw new ValidationError("Source group still has commissions after reassignment.");
  return {
    canonicalGroupId: input.canonicalGroupId,
    sourceGroupId: input.sourceGroupId,
    commissionIds: commissions.map((row) => row.id),
    identityCount: identities.length,
  };
}

export async function repairImportStatementLinkage(
  db: AppDatabase | undefined,
  input: { commissionId: number; importStatementId: number; sourceRowKey: string },
) {
  const database = await resolveDb(db);
  const before = await frozenFinancials(database, input.commissionId);
  const statement = await getImportStatement(database, input.importStatementId);
  if (!statement) throw new NotFoundError("Import statement not found.");
  if (statement.paidMonth !== before.commission.statementMonth) {
    throw new ValidationError("Import linkage repair cannot change paid month.");
  }
  if (before.commission.importStatementId && before.commission.importStatementId !== input.importStatementId) {
    throw new ValidationError("Commission is already linked to a different import statement.");
  }
  if (before.commission.sourceRowKey && before.commission.sourceRowKey !== input.sourceRowKey) {
    throw new ValidationError("Commission already has a different source-row key.");
  }
  const postedKeys = await listPostedSourceRowKeys(database, input.importStatementId);
  if (postedKeys.includes(input.sourceRowKey) && before.commission.sourceRowKey !== input.sourceRowKey) {
    throw new ValidationError("That import source-row key is already linked to another commission.");
  }

  await database.update(commissionRecords).set({
    importStatementId: input.importStatementId,
    sourceRowKey: input.sourceRowKey,
    updatedAt: new Date().toISOString(),
  }).where(eq(commissionRecords.id, input.commissionId));

  const after = await frozenFinancials(database, input.commissionId);
  assertFinancialsUnchanged(before, after);
  if (after.commission.groupId !== before.commission.groupId) {
    throw new ValidationError("Import linkage repair cannot change Group.");
  }
  return after.commission;
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
  carrierId: number,
) {
  const database = await resolveDb(db);
  const carrier = await getCarrier(database, carrierId);
  if (!carrier || !isAnthemFamilyCarrier(carrier.name)) {
    throw new ValidationError("Coverage normalization is limited to Anthem/Elevance carriers.");
  }
  const lines = await listLinesOfBusiness(database);
  const commissions = await database
    .select({ id: commissionRecords.id })
    .from(commissionRecords)
    .where(eq(commissionRecords.carrierId, carrierId));
  const remapped: number[] = [];
  for (const row of commissions) {
    const before = await frozenFinancials(database, row.id);
    const sourceValue = before.commission.sourceCoverageLabel || before.commission.lineOfBusinessName;
    const family = deterministicCoverageFamily(carrier.name, sourceValue);
    if (!family) continue;
    const mapped = applyDeterministicCoverageMapping(
      { status: "matched", id: before.commission.lineOfBusinessId, name: before.commission.lineOfBusinessName, source: sourceValue },
      { carrierName: carrier.name, sourceValue, lines },
    );
    if (mapped.status !== "matched" || mapped.id == null || mapped.id === before.commission.lineOfBusinessId) continue;
    if (!await getLineOfBusiness(database, mapped.id)) continue;
    await database.update(commissionRecords).set({
      lineOfBusinessId: mapped.id,
      sourceCoverageLabel: before.commission.sourceCoverageLabel || sourceValue,
      updatedAt: new Date().toISOString(),
    }).where(eq(commissionRecords.id, row.id));
    const after = await frozenFinancials(database, row.id);
    assertFinancialsUnchanged(before, after);
    remapped.push(row.id);
  }
  await rememberDeterministicCoverageAliases(database, carrierId);
  return { remappedCommissionIds: remapped };
}
