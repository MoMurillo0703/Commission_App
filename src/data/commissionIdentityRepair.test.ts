import { describe, expect, it } from "vitest";
import { createAccountManager } from "./accountManagers";
import { createAllocation } from "./allocations";
import { createCarrier } from "./carriers";
import { createCommission, getCommission, listPostedSourceRowKeys } from "./commissions";
import { createGroup, getGroup } from "./groups";
import { createLineOfBusiness } from "./linesOfBusiness";
import { listPayoutsForCommission } from "./payouts";
import { createImportStatement } from "./statements";
import { rememberCarrierGroupIdentity } from "./carrierGroupIdentities";
import {
  CANONICAL_HR_LABOR_GROUP_ID,
  normalizePostedAnthemCoverage,
  reassignCommissionsToCanonicalGroup,
  rememberDeterministicCoverageAliases,
  repairHrLaborIdentity,
  repairImportStatementLinkage,
} from "./commissionIdentityRepair";
import { listCarrierCoverageAliases } from "./carrierCoverage";
import { listAllocations } from "./allocations";
import { createTestDb } from "@/db/test-db";
import { fingerprintBuffer } from "@/domain/fingerprint";
import { commissionRecords } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { StatementPreview } from "@/domain/workbook";

function previewWithRows(rows: Array<{ key: string; group: string; amount: string }>): StatementPreview {
  return {
    sheets: [{
      name: "Commissions",
      headerRowNumber: 1,
      rowCount: rows.length,
      headers: ["Group", "Commission"],
      groupNameHeader: "Group",
      groupNumberHeader: null,
      premiumMonthHeader: null,
      rows: rows.map((row, index) => ({
        rowNumber: index + 1,
        values: { Group: row.group, Commission: row.amount },
        premiumMonth: null,
        group: { status: "matched", groupId: null, groupName: row.group, sourceName: row.group, sourceNumber: null },
        sourceIdentity: row.key,
      })),
    }],
    unmatchedGroups: [],
    rowCount: rows.length,
    newGroupCount: 0,
  };
}

async function statement(
  db: Awaited<ReturnType<typeof createTestDb>>,
  paidMonth: string,
  fingerprintSeed: string,
  preview: StatementPreview = previewWithRows([]),
  carrierId?: number,
) {
  return createImportStatement(db, {
    originalFilename: `${fingerprintSeed}.csv`,
    paidMonth,
    sourceType: "csv",
    status: "posted",
    fingerprint: fingerprintBuffer(new TextEncoder().encode(fingerprintSeed)),
    carrierId,
    preview,
  });
}

describe("commission identity repair", () => {
  it("reassigns cross-carrier H&R commissions onto one Group without changing money or deleting records", async () => {
    const db = await createTestDb();
    const manager = await createAccountManager(db, { name: "Laura" });
    const anthem = await createCarrier(db, { name: "Anthem" });
    const choice = await createCarrier(db, { name: "ChoiceBuilder" });
    const dental = await createLineOfBusiness(db, { name: "Dental" });
    const medical = await createLineOfBusiness(db, { name: "Medical" });
    const anthemGroup = await createGroup(db, { name: "H & R LABOR CONTRACTING INC", accountManagerId: manager.id });
    const choiceGroup = await createGroup(db, { name: "H & R LABOR CONTRACTING INC" });
    await rememberCarrierGroupIdentity(db, { carrierId: anthem.id, externalGroupNumber: "8", groupId: anthemGroup.id });
    await rememberCarrierGroupIdentity(db, { carrierId: choice.id, externalGroupNumber: "29", groupId: choiceGroup.id });
    const sourceAllocation = await createAllocation(db, {
      groupId: anthemGroup.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2026-09",
      entries: [{ recipientType: "agency", compensationBps: 10000 }],
    });

    const anthemMedical = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: anthemGroup.id,
      carrierId: anthem.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 35196,
      premiumMonth: "2026-07",
      sourceGroupLabel: "H&R LABOR",
    });
    const choiceDental = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: choiceGroup.id,
      carrierId: choice.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 4659,
      premiumMonth: "2026-07",
    });
    const chargeback = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: choiceGroup.id,
      carrierId: choice.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: -89,
    });
    const anthemPayouts = await listPayoutsForCommission(db, anthemMedical.id);

    const result = await reassignCommissionsToCanonicalGroup(db, {
      sourceGroupId: anthemGroup.id,
      canonicalGroupId: choiceGroup.id,
    });
    expect(result.commissionIds).toEqual([anthemMedical.id]);
    expect(result.allocations.transferred).toBe(false);
    expect(result.allocations.sourceAllocationIds).toEqual([sourceAllocation.id]);
    expect(result.assignments.copied.accountManager).toBe(true);
    const moved = await getCommission(db, anthemMedical.id);
    expect(moved?.groupId).toBe(choiceGroup.id);
    expect(moved?.grossCommissionCents).toBe(35196);
    expect(moved?.statementMonth).toBe("2026-09");
    expect(moved?.premiumMonth).toBe("2026-07");
    expect(moved?.sourceGroupLabel).toBe("H&R LABOR");
    expect((await getCommission(db, choiceDental.id))?.groupId).toBe(choiceGroup.id);
    expect((await getCommission(db, chargeback.id))?.grossCommissionCents).toBe(-89);
    expect(await db.select().from(commissionRecords).where(eq(commissionRecords.groupId, anthemGroup.id))).toHaveLength(0);
    expect(await listPayoutsForCommission(db, anthemMedical.id)).toEqual(anthemPayouts);
    expect(await db.select().from(commissionRecords)).toHaveLength(3);
    expect((await getGroup(db, anthemGroup.id))?.name).toBe("H & R LABOR CONTRACTING INC");
    expect((await getGroup(db, choiceGroup.id))?.accountManagerId).toBe(manager.id);
    expect((await listAllocations(db)).filter((row) => row.groupId === choiceGroup.id)).toHaveLength(0);
    expect((await listAllocations(db)).filter((row) => row.groupId === anthemGroup.id).map((row) => row.id)).toEqual([sourceAllocation.id]);
  });

  it("requires H&R Labor to reconcile to Group 29", async () => {
    expect(CANONICAL_HR_LABOR_GROUP_ID).toBe(29);
    const db = await createTestDb();
    const source = await createGroup(db, { name: "H&R source" });
    await expect(repairHrLaborIdentity(db, { sourceGroupId: source.id, canonicalGroupId: 8 })).rejects.toThrow(/Group 29/);
  });

  it("repairs missing import linkage without changing gross, Group, or paid month", async () => {
    const db = await createTestDb();
    const carrier = await createCarrier(db, { name: "Anthem" });
    const group = await createGroup(db, { name: "RELYON" });
    const medical = await createLineOfBusiness(db, { name: "Medical" });
    const importStatement = await statement(db, "2026-09", "anthem-statement-3", previewWithRows([
      { key: "Commissions:43", group: "RELYON", amount: "33.33" },
      { key: "Commissions:49", group: "ACKEE HOLDING", amount: "0.00" },
    ]), carrier.id);
    const relyon = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 3333,
    });
    const ackeeGroup = await createGroup(db, { name: "ACKEE HOLDING" });
    const ackee = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: ackeeGroup.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 0,
    });

    const repaired = await repairImportStatementLinkage(db, {
      commissionId: relyon.id,
      importStatementId: importStatement.id,
      sourceRowKey: "Commissions:43",
    });
    expect(repaired.importStatementId).toBe(importStatement.id);
    expect(repaired.sourceRowKey).toBe("Commissions:43");
    expect(repaired.grossCommissionCents).toBe(3333);
    expect(repaired.groupId).toBe(group.id);
    expect(repaired.statementMonth).toBe("2026-09");

    await repairImportStatementLinkage(db, {
      commissionId: ackee.id,
      importStatementId: importStatement.id,
      sourceRowKey: "Commissions:49",
    });
    expect(await listPostedSourceRowKeys(db, importStatement.id)).toEqual(["Commissions:43", "Commissions:49"]);
  });

  it("rejects import linkage when the source row is missing or the carrier does not match", async () => {
    const db = await createTestDb();
    const anthem = await createCarrier(db, { name: "Anthem" });
    const choice = await createCarrier(db, { name: "ChoiceBuilder" });
    const group = await createGroup(db, { name: "RELYON" });
    const medical = await createLineOfBusiness(db, { name: "Medical" });
    const statementRow = await statement(db, "2026-09", "wrong-carrier", previewWithRows([
      { key: "Commissions:43", group: "RELYON", amount: "33.33" },
    ]), choice.id);
    const commission = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: anthem.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 3333,
    });
    await expect(repairImportStatementLinkage(db, {
      commissionId: commission.id,
      importStatementId: statementRow.id,
      sourceRowKey: "Commissions:43",
    })).rejects.toThrow(/matching carrier/);

    const empty = await statement(db, "2026-09", "empty-preview", previewWithRows([]), anthem.id);
    await expect(repairImportStatementLinkage(db, {
      commissionId: commission.id,
      importStatementId: empty.id,
      sourceRowKey: "Commissions:43",
    })).rejects.toThrow(/Source row is not on the target statement/);
  });

  it("normalizes an explicit Anthem commission set to Group LOBs while preserving raw codes and payouts", async () => {
    const db = await createTestDb();
    const anthem = await createCarrier(db, { name: "Anthem" });
    const group = await createGroup(db, { name: "H & R LABOR CONTRACTING INC" });
    const rawMed = await createLineOfBusiness(db, { name: "MED" });
    const medical = await createLineOfBusiness(db, { name: "Medical" });
    const groupMedical = await createLineOfBusiness(db, { name: "Group Medical" });
    await createLineOfBusiness(db, { name: "Group Dental" });
    await createLineOfBusiness(db, { name: "Group Vision" });
    const posted = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: anthem.id,
      lineOfBusinessId: rawMed.id,
      grossCommissionCents: 35196,
      sourceCoverageLabel: "MED",
    });
    const other = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: anthem.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 1200,
      sourceCoverageLabel: "LIFE",
    });
    const payouts = await listPayoutsForCommission(db, posted.id);
    await rememberDeterministicCoverageAliases(db, anthem.id);
    const aliases = await listCarrierCoverageAliases(db, anthem.id);
    expect(aliases.map((row) => row.sourceValue).sort()).toEqual(["denppo", "med", "medhmo", "vis"]);
    expect(aliases.find((row) => row.sourceValue === "med")?.lineOfBusinessId).toBe(groupMedical.id);

    await expect(normalizePostedAnthemCoverage(db, { carrierId: anthem.id, commissionIds: [] })).rejects.toThrow(/explicit commission set/);
    const result = await normalizePostedAnthemCoverage(db, { carrierId: anthem.id, commissionIds: [posted.id] });
    expect(result.remappedCommissionIds).toEqual([posted.id]);
    expect(result.mappings).toEqual({
      MED: "Group Medical",
      MEDHMO: "Group Medical",
      DENPPO: "Group Dental",
      VIS: "Group Vision",
    });
    const after = await getCommission(db, posted.id);
    expect(after?.lineOfBusinessId).toBe(groupMedical.id);
    expect(after?.lineOfBusinessName).toBe("Group Medical");
    expect(after?.sourceCoverageLabel).toBe("MED");
    expect(after?.sourceLobLabel).toBe("MED");
    expect(after?.grossCommissionCents).toBe(35196);
    expect(await listPayoutsForCommission(db, posted.id)).toEqual(payouts);
    expect((await getCommission(db, other.id))?.lineOfBusinessId).toBe(medical.id);
  });
});
