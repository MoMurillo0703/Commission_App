import { describe, expect, it } from "vitest";
import { createCarrier } from "./carriers";
import { createCommission, getCommission, listPostedSourceRowKeys } from "./commissions";
import { createGroup } from "./groups";
import { createLineOfBusiness } from "./linesOfBusiness";
import { listPayoutsForCommission } from "./payouts";
import { createImportStatement } from "./statements";
import { rememberCarrierGroupIdentity } from "./carrierGroupIdentities";
import {
  normalizePostedAnthemCoverage,
  reassignCommissionsToCanonicalGroup,
  rememberDeterministicCoverageAliases,
  repairImportStatementLinkage,
} from "./commissionIdentityRepair";
import { listCarrierCoverageAliases } from "./carrierCoverage";
import { createTestDb } from "@/db/test-db";
import { fingerprintBuffer } from "@/domain/fingerprint";
import { commissionRecords } from "@/db/schema";
import { eq } from "drizzle-orm";

async function statement(db: Awaited<ReturnType<typeof createTestDb>>, paidMonth: string, fingerprintSeed: string) {
  return createImportStatement(db, {
    originalFilename: `${fingerprintSeed}.csv`,
    paidMonth,
    sourceType: "csv",
    status: "posted",
    fingerprint: fingerprintBuffer(new TextEncoder().encode(fingerprintSeed)),
    preview: {
      sheets: [],
      unmatchedGroups: [],
      rowCount: 1,
      newGroupCount: 0,
    },
  });
}

describe("commission identity repair", () => {
  it("reassigns cross-carrier H&R commissions onto one Group without changing money or deleting records", async () => {
    const db = await createTestDb();
    const anthem = await createCarrier(db, { name: "Anthem" });
    const choice = await createCarrier(db, { name: "ChoiceBuilder" });
    const dental = await createLineOfBusiness(db, { name: "Dental" });
    const medical = await createLineOfBusiness(db, { name: "Medical" });
    const anthemGroup = await createGroup(db, { name: "H & R LABOR CONTRACTING INC" });
    const choiceGroup = await createGroup(db, { name: "H & R LABOR CONTRACTING INC" });
    await rememberCarrierGroupIdentity(db, { carrierId: anthem.id, externalGroupNumber: "8", groupId: anthemGroup.id });
    await rememberCarrierGroupIdentity(db, { carrierId: choice.id, externalGroupNumber: "29", groupId: choiceGroup.id });

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
  });

  it("repairs missing import linkage without changing gross, Group, or paid month", async () => {
    const db = await createTestDb();
    const carrier = await createCarrier(db, { name: "Anthem" });
    const group = await createGroup(db, { name: "RELYON" });
    const medical = await createLineOfBusiness(db, { name: "Medical" });
    const importStatement = await statement(db, "2026-09", "anthem-statement-3");
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

  it("normalizes deterministic Anthem LOBs while preserving raw source identity and payouts", async () => {
    const db = await createTestDb();
    const anthem = await createCarrier(db, { name: "Anthem" });
    const group = await createGroup(db, { name: "H & R LABOR CONTRACTING INC" });
    const rawMed = await createLineOfBusiness(db, { name: "MED" });
    const medical = await createLineOfBusiness(db, { name: "Medical" });
    await createLineOfBusiness(db, { name: "Dental" });
    await createLineOfBusiness(db, { name: "Vision" });
    const posted = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: anthem.id,
      lineOfBusinessId: rawMed.id,
      grossCommissionCents: 35196,
      sourceCoverageLabel: "MED",
    });
    const payouts = await listPayoutsForCommission(db, posted.id);
    await rememberDeterministicCoverageAliases(db, anthem.id);
    const aliases = await listCarrierCoverageAliases(db, anthem.id);
    expect(aliases.map((row) => row.sourceValue).sort()).toEqual(["denppo", "med", "medhmo", "vis"]);

    const result = await normalizePostedAnthemCoverage(db, anthem.id);
    expect(result.remappedCommissionIds).toEqual([posted.id]);
    const after = await getCommission(db, posted.id);
    expect(after?.lineOfBusinessId).toBe(medical.id);
    expect(after?.lineOfBusinessName).toBe("Medical");
    expect(after?.sourceCoverageLabel).toBe("MED");
    expect(after?.grossCommissionCents).toBe(35196);
    expect(await listPayoutsForCommission(db, posted.id)).toEqual(payouts);
  });
});
