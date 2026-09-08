import { describe, expect, it } from "vitest";
import { createAccountManager } from "./accountManagers";
import { createAgent } from "./agents";
import { createAgencyCompensationOwner } from "./agencyOwner";
import { createAllocation } from "./allocations";
import { buildAgencyOwnerReport, buildMonthlyCompensationReconciliation } from "./businessCompensation";
import { createCarrier } from "./carriers";
import { createCommission } from "./commissions";
import { confirmCompensationCorrection, previewCompensationCorrection } from "./compensationCorrections";
import { createGroup } from "./groups";
import { createLineOfBusiness } from "./linesOfBusiness";
import { createTeam } from "./teams";
import { commissionPayouts, commissionRecords } from "@/db/schema";
import { createTestDb } from "@/db/test-db";
import { stalePreviewMessage } from "@/domain/compensationCorrection";
import { LEGACY_NO_PAYOUT_LABEL } from "@/domain/compensationFallback";
import { eq } from "drizzle-orm";

const initiator = { id: "user-1", email: "mo@example.com", name: "Mo Murillo" };

async function seed() {
  const db = await createTestDb();
  const john = await createAgent(db, { name: "John Elizondo" });
  const mo = await createAgent(db, { name: "MURILLO, MAURILIO" });
  const laura = await createAccountManager(db, { name: "Laura Montoya" });
  const nancy = await createAccountManager(db, { name: "Nancy Guerra" });
  const groupA = await createGroup(db, { name: "Group A", primaryAgentId: john.id });
  const groupB = await createGroup(db, { name: "Group B", primaryAgentId: mo.id });
  const carrierA = await createCarrier(db, { name: "Carrier A" });
  const carrierB = await createCarrier(db, { name: "Carrier B" });
  const medical = await createLineOfBusiness(db, { name: "Medical" });
  const dental = await createLineOfBusiness(db, { name: "Dental" });
  await createAgencyCompensationOwner(db, {
    agentId: mo.id,
    effectiveStartMonth: "2026-01",
  });
  const team = await createTeam(db, {
    name: "Cal Choice Team",
    members: [
      { personKind: "agent", personId: john.id, shareBps: 7000, effectiveStart: "2026-09" },
      { personKind: "agent", personId: mo.id, shareBps: 2000, effectiveStart: "2026-09" },
      { personKind: "account_manager", personId: laura.id, shareBps: 500, effectiveStart: "2026-09" },
      { personKind: "account_manager", personId: nancy.id, shareBps: 500, effectiveStart: "2026-09" },
    ],
  });
  await createAllocation(db, {
    groupId: groupA.id,
    lineOfBusinessId: medical.id,
    effectiveStart: "2026-09",
    entries: [{ recipientType: "team", teamId: team.id, compensationBps: 10000 }],
  });
  return { db, john, mo, laura, nancy, groupA, groupB, carrierA, carrierB, medical, dental, team };
}

describe("Mo / Agency report filters and owner", () => {
  it("honors Group, Carrier, and LOB filters with matching header and detail totals", async () => {
    const { db, groupA, groupB, carrierA, carrierB, medical, dental } = await seed();
    await createCommission(db, {
      statementMonth: "2026-09",
      groupId: groupA.id,
      carrierId: carrierA.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 10000,
    });
    await createCommission(db, {
      statementMonth: "2026-09",
      groupId: groupB.id,
      carrierId: carrierB.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 4000,
    });

    const all = await buildAgencyOwnerReport(db, { paidMonth: "2026-09" });
    const group = await buildAgencyOwnerReport(db, { paidMonth: "2026-09", groupId: groupA.id });
    const carrier = await buildAgencyOwnerReport(db, { paidMonth: "2026-09", carrierId: carrierB.id });
    const lob = await buildAgencyOwnerReport(db, { paidMonth: "2026-09", lineOfBusinessId: medical.id });

    expect(all.reconciliation.grossCents).toBe(14000);
    expect(all.headerDetail.grossCents).toBe(all.reconciliation.grossCents);
    expect(all.headerDetail.moAgencyCents).toBe(all.reconciliation.moAgencyCents);
    expect(group.reconciliation.grossCents).toBe(10000);
    expect(group.headerDetail.moAgencyCents).toBe(group.reconciliation.moAgencyCents);
    expect(carrier.reconciliation.grossCents).toBe(4000);
    expect(lob.reconciliation.grossCents).toBe(10000);
    expect(all.reconciliation.moAgencyCents).toBe(2000);
    expect(group.reconciliation.moAgencyCents).toBe(2000);
  });

  it("does not include unresolved fallback or no-payout dollars in Mo / Agency payable totals", async () => {
    const { db, groupB, carrierB, dental, medical, groupA } = await seed();
    const fallback = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: groupB.id,
      carrierId: carrierB.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 8000,
    });
    const now = new Date().toISOString();
    const [noPayout] = await db.insert(commissionRecords).values({
      statementMonth: "2026-09",
      groupId: groupA.id,
      carrierId: carrierB.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 5000,
      agentCompensationCents: 0,
      agencyNetCents: 5000,
      createdAt: now,
      updatedAt: now,
    }).returning();

    const report = await buildMonthlyCompensationReconciliation(db, { paidMonth: "2026-09" });
    expect(fallback.agencyNetCents).toBe(8000);
    expect(report.reconciliation.fallbackCommissionCount).toBeGreaterThanOrEqual(1);
    expect(report.reconciliation.legacyNoPayoutCount).toBe(1);
    expect(report.reconciliation.legacyNoPayoutCents).toBe(5000);
    expect(report.reconciliation.moAgencyCents).toBe(0);
    expect(report.reconciliation.payableReady).toBe(false);
    expect(noPayout.id).toBeGreaterThan(0);
  });
});

describe("legacy no-payout correction preview", () => {
  it("prepares the 0008 class without becoming eligible merely because a current allocation exists", async () => {
    const db = await createTestDb();
    const john = await createAgent(db, { name: "John Elizondo" });
    const group = await createGroup(db, { name: "ABC COMPANY", primaryAgentId: john.id });
    const carrier = await createCarrier(db, { name: "Principal" });
    const medical = await createLineOfBusiness(db, { name: "Medical" });
    const now = new Date().toISOString();
    const [legacy] = await db.insert(commissionRecords).values({
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 2500,
      agentCompensationCents: 0,
      agencyNetCents: 2500,
      createdAt: now,
      updatedAt: now,
    }).returning();

    const currentOnly = await previewCompensationCorrection(db, [legacy.id]);
    expect(currentOnly.items[0]?.original.label).toBe(LEGACY_NO_PAYOUT_LABEL);
    expect(currentOnly.correctableIds).toEqual([]);
    expect(currentOnly.items[0]?.blockedReason).toMatch(/original paid month/i);

    await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2026-09",
      entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }],
    });
    const newerOnly = await previewCompensationCorrection(db, [legacy.id]);
    expect(newerOnly.correctableIds).toEqual([]);
    expect(newerOnly.items[0]?.blockedReason).toMatch(/newer allocation/i);

    await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2026-08",
      effectiveEnd: "2026-08",
      entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }],
    });
    const covering = await previewCompensationCorrection(db, [legacy.id]);
    expect(covering.correctableIds).toEqual([legacy.id]);
    expect(covering.items[0]?.proposed).not.toBeNull();
    expect(covering.previewToken).toBeTruthy();
  });

  it("shows existing header compensation on a legacy no-payout preview", async () => {
    const db = await createTestDb();
    const john = await createAgent(db, { name: "John Elizondo" });
    const group = await createGroup(db, { name: "ABC COMPANY", primaryAgentId: john.id });
    const carrier = await createCarrier(db, { name: "Principal" });
    const medical = await createLineOfBusiness(db, { name: "Medical" });
    const now = new Date().toISOString();
    const [legacy] = await db.insert(commissionRecords).values({
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 3333,
      agentCompensationCents: 3333,
      agencyNetCents: 0,
      createdAt: now,
      updatedAt: now,
    }).returning();
    await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2026-09",
      entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }],
    });
    const preview = await previewCompensationCorrection(db, [legacy.id]);
    expect(preview.items[0]?.original).toMatchObject({
      sourceClass: "legacy_no_payout_snapshot",
      sourceLabel: LEGACY_NO_PAYOUT_LABEL,
      grossCommissionCents: 3333,
      agentCompensationCents: 3333,
      agencyNetCents: 0,
      payoutCount: 0,
      payoutSnapshotLabel: "None",
    });
    expect(preview.items[0]?.proposed?.recipients.length).toBeGreaterThan(0);
    expect(preview.items[0]?.proposed?.agencyNetCents).toBe(0);
  });

  it("rejects confirmation after original no-payout values change and confirms when unchanged", async () => {
    const db = await createTestDb();
    const john = await createAgent(db, { name: "John Elizondo" });
    const group = await createGroup(db, { name: "ABC COMPANY", primaryAgentId: john.id });
    const carrier = await createCarrier(db, { name: "Principal" });
    const medical = await createLineOfBusiness(db, { name: "Medical" });
    const now = new Date().toISOString();
    const [legacy] = await db.insert(commissionRecords).values({
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 2500,
      agentCompensationCents: 0,
      agencyNetCents: 2500,
      createdAt: now,
      updatedAt: now,
    }).returning();
    await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2026-09",
      entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }],
    });

    async function expectStale(mutate: () => Promise<void>) {
      const preview = await previewCompensationCorrection(db, [legacy.id]);
      expect(preview.previewToken).toBeTruthy();
      await mutate();
      await expect(confirmCompensationCorrection(db, {
        commissionIds: [legacy.id],
        reason: "Authorized after stale original",
        confirmationKey: `stale-${Math.random().toString(16).slice(2)}`,
        previewToken: preview.previewToken!,
        initiator,
      })).rejects.toThrow(stalePreviewMessage());
    }

    await expectStale(async () => {
      await db.update(commissionRecords).set({
        agentCompensationCents: 100,
        agencyNetCents: 2400,
      }).where(eq(commissionRecords.id, legacy.id));
    });
    await db.update(commissionRecords).set({
      agentCompensationCents: 0,
      agencyNetCents: 2500,
      grossCommissionCents: 2500,
    }).where(eq(commissionRecords.id, legacy.id));

    await expectStale(async () => {
      await db.update(commissionRecords).set({
        agentCompensationCents: 400,
        agencyNetCents: 2100,
      }).where(eq(commissionRecords.id, legacy.id));
    });
    await db.update(commissionRecords).set({
      agentCompensationCents: 0,
      agencyNetCents: 2500,
    }).where(eq(commissionRecords.id, legacy.id));

    await expectStale(async () => {
      await db.update(commissionRecords).set({
        grossCommissionCents: 2600,
        agencyNetCents: 2600,
      }).where(eq(commissionRecords.id, legacy.id));
    });
    await db.update(commissionRecords).set({
      grossCommissionCents: 2500,
      agencyNetCents: 2500,
    }).where(eq(commissionRecords.id, legacy.id));

    await expectStale(async () => {
      await db.insert(commissionPayouts).values({
        commissionId: legacy.id,
        allocationId: null,
        recipientType: "agency",
        allocationBps: 10000,
        compensationCents: 2500,
        createdAt: new Date().toISOString(),
      });
    });
    await db.delete(commissionPayouts).where(eq(commissionPayouts.commissionId, legacy.id));

    await expectStale(async () => {
      await db.insert(commissionPayouts).values({
        commissionId: legacy.id,
        allocationId: null,
        recipientType: "person",
        personKind: "agent",
        personId: john.id,
        allocationBps: 10000,
        compensationCents: 2500,
        createdAt: new Date().toISOString(),
      });
    });
    await db.delete(commissionPayouts).where(eq(commissionPayouts.commissionId, legacy.id));

    const fresh = await previewCompensationCorrection(db, [legacy.id]);
    const confirmed = await confirmCompensationCorrection(db, {
      commissionIds: [legacy.id],
      reason: "Authorized unchanged no-payout preview",
      confirmationKey: "no-payout-confirm-1",
      previewToken: fresh.previewToken!,
      initiator,
    });
    expect(confirmed.replayed).toBe(false);
    expect(confirmed.commissionIds).toEqual([legacy.id]);
  });
});

describe("Mo / Agency owner coverage", () => {
  it("marks single-month, range, and YTD reports NOT PAYABLE-READY when a paid month lacks an owner", async () => {
    const db = await createTestDb();
    const john = await createAgent(db, { name: "John Elizondo" });
    const mo = await createAgent(db, { name: "MURILLO, MAURILIO" });
    const group = await createGroup(db, { name: "Group A", primaryAgentId: john.id });
    const carrier = await createCarrier(db, { name: "Carrier A" });
    const medical = await createLineOfBusiness(db, { name: "Medical" });
    await createAgencyCompensationOwner(db, {
      agentId: mo.id,
      effectiveStartMonth: "2026-09",
    });
    await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2026-08",
      entries: [{ recipientType: "person", personKind: "agent", personId: mo.id, compensationBps: 10000 }],
    });
    await createCommission(db, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 2000,
    });
    await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 4000,
    });

    const covered = await buildAgencyOwnerReport(db, { paidMonth: "2026-09" });
    expect(covered.ownerConfigured).toBe(true);
    expect(covered.reconciliation.moAgencyCents).toBe(4000);
    expect(covered.reconciliation.payableReady).toBe(true);
    expect(covered.reconciliation.otherCents).toBe(0);

    const gap = await buildAgencyOwnerReport(db, { paidMonth: "2026-08" });
    expect(gap.reconciliation.payableReady).toBe(false);
    expect(gap.reconciliation.missingOwnerMonths).toEqual(["2026-08"]);
    expect(gap.reconciliation.moAgencyCents).toBe(0);
    expect(gap.reconciliation.namedCents[`agent:${mo.id}`]).toBe(2000);
    expect(gap.reconciliation.otherCents).toBe(0);
    expect(gap.reconciliation.payableReadyMessage).toMatch(/August 2026/);

    const range = await buildAgencyOwnerReport(db, { startMonth: "2026-08", endMonth: "2026-09" });
    expect(range.reconciliation.payableReady).toBe(false);
    expect(range.reconciliation.missingOwnerMonths).toEqual(["2026-08"]);
    expect(range.reconciliation.moAgencyCents).toBe(4000);
    expect(range.reconciliation.otherCents).toBe(0);

    const ytd = await buildAgencyOwnerReport(db, { ytd: true, startMonth: "2026-01", endMonth: "2026-09" });
    expect(ytd.reconciliation.payableReady).toBe(false);
    expect(ytd.reconciliation.missingOwnerMonths).toEqual(["2026-08"]);
  });
});
