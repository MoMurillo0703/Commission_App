import { afterEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createAccountManager } from "./accountManagers";
import { createAgent } from "./agents";
import { createAllocation, updateAllocation } from "./allocations";
import { createCarrier } from "./carriers";
import {
  normalizePostedAnthemCoverage,
  repairHrLaborIdentity,
  repairImportStatementLinkage,
} from "./commissionIdentityRepair";
import { createCommission, getCommission, updateCommission } from "./commissions";
import { confirmCompensationCorrection, previewCompensationCorrection } from "./compensationCorrections";
import { createGroup } from "./groups";
import { createLineOfBusiness } from "./linesOfBusiness";
import { listPayoutsForCommission } from "./payouts";
import { confirmStatementPaidMonthChange, previewStatementPaidMonthChange } from "./statementPaidMonthChange";
import { createImportStatement, getImportStatement } from "./statements";
import { createTeam, replaceTeamMembers } from "./teams";
import { setAfterAllocationNamespaceLock, setTransactionFailPoint } from "./transactionTestHook";
import { createTestDb } from "@/db/test-db";
import {
  commissionPayouts,
  commissionRecords,
} from "@/db/schema";
import { fingerprintBuffer } from "@/domain/fingerprint";
import type { StatementPreview } from "@/domain/workbook";

const initiator = { id: "user-1", email: "mo@example.com", name: "Mo Murillo" };

afterEach(() => {
  setTransactionFailPoint(null);
  setAfterAllocationNamespaceLock(null);
});

function preview(rows: Array<{ key: string; group: string; amount: string }> = [
  { key: "Commissions:1", group: "Acme", amount: "100.00" },
]): StatementPreview {
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

async function postedFixture(seed: string) {
  const db = await createTestDb();
  const john = await createAgent(db, { name: "John Elizondo" });
  const mo = await createAgent(db, { name: "Mo Murillo" });
  const laura = await createAccountManager(db, { name: "Laura" });
  const nancy = await createAccountManager(db, { name: "Nancy" });
  const group = await createGroup(db, { name: "Acme Benefits" });
  const carrier = await createCarrier(db, { name: "Principal" });
  const dental = await createLineOfBusiness(db, { name: "Dental" });
  const statement = await createImportStatement(db, {
    originalFilename: `${seed}.csv`,
    displayName: "Principal September",
    paidMonth: "2026-09",
    carrierId: carrier.id,
    sourceType: "csv",
    status: "posted",
    fingerprint: fingerprintBuffer(new TextEncoder().encode(seed)),
    preview: preview(),
  });
  return { db, john, mo, laura, nancy, group, carrier, dental, statement };
}

describe("final integrity correction batch", () => {
  it("A. classifies different effective Team membership as changed compensation terms", async () => {
    const { db, john, mo, laura, nancy, group, carrier, dental, statement } = await postedFixture("team-membership");
    const team = await createTeam(db, {
      name: "Team X",
      members: [
        { personKind: "agent", personId: john.id, shareBps: 7000, effectiveStart: "2026-01" },
        { personKind: "agent", personId: mo.id, shareBps: 3000, effectiveStart: "2026-01" },
      ],
    });
    await replaceTeamMembers(db, team.id, [
      { personKind: "agent", personId: john.id, shareBps: 7000, effectiveStart: "2026-09" },
      { personKind: "agent", personId: mo.id, shareBps: 2000, effectiveStart: "2026-09" },
      { personKind: "account_manager", personId: laura.id, shareBps: 500, effectiveStart: "2026-09" },
      { personKind: "account_manager", personId: nancy.id, shareBps: 500, effectiveStart: "2026-09" },
    ], { requireComplete: true, closePrior: true });
    await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: dental.id,
      effectiveStart: "2026-01",
      entries: [{ recipientType: "team", teamId: team.id, compensationBps: 10000 }],
    });
    await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 10000,
      importStatementId: statement.id,
      sourceRowKey: "Commissions:1",
    });
    const impact = await previewStatementPaidMonthChange(db, statement.id, "2026-08");
    expect(impact.items[0]?.impactClass).toBe("different_terms");
    expect(impact.confirmable).toBe(false);
    await expect(confirmStatementPaidMonthChange(db, {
      statementId: statement.id,
      newPaidMonth: "2026-08",
      reason: "Membership changed.",
      confirmationKey: "team-terms-1",
      previewToken: impact.previewToken,
      initiator,
    })).rejects.toThrow(/different compensation terms/);
    expect((await getImportStatement(db, statement.id))?.paidMonth).toBe("2026-09");
  });

  it("B. rejects confirmation after any financially relevant preview-bound state changes", async () => {
    const { db, john, mo, carrier, dental } = await postedFixture("stale-preview-all");
    const otherGroup = await createGroup(db, { name: "Other Book" });
    const otherCarrier = await createCarrier(db, { name: "Other Carrier Stale" });
    const medical = await createLineOfBusiness(db, { name: "Medical Stale" });
    const mutations: Array<{
      kind: string;
      mutate: (input: {
        statementId: number;
        postedId: number;
        allocationId: number;
        teamId: number;
      }) => Promise<void>;
    }> = [
      { kind: "group", mutate: async ({ postedId }) => { await db.update(commissionRecords).set({ groupId: otherGroup.id }).where(eq(commissionRecords.id, postedId)); } },
      { kind: "carrier", mutate: async ({ postedId }) => { await db.update(commissionRecords).set({ carrierId: otherCarrier.id }).where(eq(commissionRecords.id, postedId)); } },
      { kind: "lob", mutate: async ({ postedId }) => { await db.update(commissionRecords).set({ lineOfBusinessId: medical.id }).where(eq(commissionRecords.id, postedId)); } },
      { kind: "coverage", mutate: async ({ postedId }) => { await db.update(commissionRecords).set({ premiumMonth: "2026-06", sourcePeriodLabel: "06-26" }).where(eq(commissionRecords.id, postedId)); } },
      { kind: "sourceCoverage", mutate: async ({ postedId }) => { await db.update(commissionRecords).set({ sourceCoverageLabel: "MED" }).where(eq(commissionRecords.id, postedId)); } },
      { kind: "agent", mutate: async ({ postedId }) => { await db.update(commissionRecords).set({ agentId: john.id }).where(eq(commissionRecords.id, postedId)); } },
      {
        kind: "headerMoney",
        mutate: async ({ postedId }) => {
          const current = await getCommission(db, postedId);
          await db.update(commissionRecords).set({
            compensationBps: 5000,
            agentCompensationCents: (current?.agentCompensationCents ?? 0) + 1,
            agencyNetCents: (current?.agencyNetCents ?? 0) - 1,
          }).where(eq(commissionRecords.id, postedId));
        },
      },
      { kind: "allocation", mutate: async ({ allocationId }) => { await updateAllocation(db, allocationId, { status: "inactive" }); } },
      {
        kind: "team",
        mutate: async ({ teamId }) => {
          await replaceTeamMembers(db, teamId, [
            { personKind: "agent", personId: john.id, shareBps: 5000, effectiveStart: "2026-09" },
            { personKind: "agent", personId: mo.id, shareBps: 5000, effectiveStart: "2026-09" },
          ], { requireComplete: true, closePrior: true });
        },
      },
      {
        kind: "payout",
        mutate: async ({ postedId }) => {
          const payout = (await listPayoutsForCommission(db, postedId))[0];
          await db.update(commissionPayouts).set({ compensationCents: payout.compensationCents + 1 }).where(eq(commissionPayouts.id, payout.id));
        },
      },
    ];

    for (const [index, { kind, mutate }] of mutations.entries()) {
      const team = await createTeam(db, {
        name: `Team ${kind}`,
        members: [
          { personKind: "agent", personId: john.id, shareBps: 7000, effectiveStart: "2026-01" },
          { personKind: "agent", personId: mo.id, shareBps: 3000, effectiveStart: "2026-01" },
        ],
      });
      const book = await createGroup(db, { name: `Stale Book ${kind}` });
      const allocation = await createAllocation(db, {
        groupId: book.id,
        lineOfBusinessId: dental.id,
        effectiveStart: "2026-01",
        entries: [{ recipientType: "team", teamId: team.id, compensationBps: 10000 }],
      });
      const statement = await createImportStatement(db, {
        originalFilename: `stale-${kind}.csv`,
        paidMonth: "2026-09",
        carrierId: carrier.id,
        sourceType: "csv",
        status: "posted",
        fingerprint: fingerprintBuffer(new TextEncoder().encode(`stale-${kind}`)),
        preview: preview(),
      });
      const posted = await createCommission(db, {
        statementMonth: "2026-09",
        groupId: book.id,
        carrierId: carrier.id,
        lineOfBusinessId: dental.id,
        grossCommissionCents: 8000 + index,
        premiumMonth: "2026-07",
        sourceGroupLabel: "Acme",
        sourceLobLabel: "Dental",
        importStatementId: statement.id,
        sourceRowKey: "Commissions:1",
      });
      const first = await previewStatementPaidMonthChange(db, statement.id, "2026-08");
      expect(first.confirmable).toBe(true);
      await mutate({ statementId: statement.id, postedId: posted.id, allocationId: allocation.id, teamId: team.id });
      await expect(confirmStatementPaidMonthChange(db, {
        statementId: statement.id,
        newPaidMonth: "2026-08",
        reason: `Stale ${kind}.`,
        confirmationKey: `stale-${kind}`,
        previewToken: first.previewToken,
        initiator,
      })).rejects.toThrow(/no longer matches|blocked until compensation|different compensation|no valid allocation/);
      expect((await getImportStatement(db, statement.id))?.paidMonth).toBe("2026-09");
      expect((await getCommission(db, posted.id))?.statementMonth).toBe("2026-09");
    }

    const fallbackGroup = await createGroup(db, { name: "Fallback Corrected" });
    const fallbackStatement = await createImportStatement(db, {
      originalFilename: "stale-corrected.csv",
      paidMonth: "2026-09",
      carrierId: carrier.id,
      sourceType: "csv",
      status: "posted",
      fingerprint: fingerprintBuffer(new TextEncoder().encode("stale-corrected")),
      preview: preview(),
    });
    const fallback = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: fallbackGroup.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 1200,
      importStatementId: fallbackStatement.id,
      sourceRowKey: "Commissions:1",
    });
    await createAllocation(db, {
      groupId: fallbackGroup.id,
      lineOfBusinessId: dental.id,
      effectiveStart: "2026-01",
      entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }],
    });
    const correctedPreview = await previewStatementPaidMonthChange(db, fallbackStatement.id, "2026-08");
    const correction = await previewCompensationCorrection(db, [fallback.id]);
    await confirmCompensationCorrection(db, {
      commissionIds: [fallback.id],
      reason: "Restore historical terms.",
      confirmationKey: "corr-stale",
      previewToken: correction.previewToken!,
      initiator,
    });
    await expect(confirmStatementPaidMonthChange(db, {
      statementId: fallbackStatement.id,
      newPaidMonth: "2026-08",
      reason: "Stale corrected state.",
      confirmationKey: "stale-corrected",
      previewToken: correctedPreview.previewToken,
      initiator,
    })).rejects.toThrow(/no longer matches/);
    expect((await getImportStatement(db, fallbackStatement.id))?.paidMonth).toBe("2026-09");
  });

  it("C-E. rejects stale allocation, Team membership, and payout decisions", async () => {
    const { db, john, mo, group, carrier, dental, statement } = await postedFixture("concurrency");
    const team = await createTeam(db, {
      name: "Concurrent Team",
      members: [
        { personKind: "agent", personId: john.id, shareBps: 6000, effectiveStart: "2026-01" },
        { personKind: "agent", personId: mo.id, shareBps: 4000, effectiveStart: "2026-01" },
      ],
    });
    const allocation = await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: dental.id,
      effectiveStart: "2026-01",
      entries: [{ recipientType: "team", teamId: team.id, compensationBps: 10000 }],
    });
    const posted = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 9000,
      importStatementId: statement.id,
      sourceRowKey: "Commissions:1",
    });
    const previewA = await previewStatementPaidMonthChange(db, statement.id, "2026-08");
    await updateAllocation(db, allocation.id, { status: "inactive" });
    await expect(confirmStatementPaidMonthChange(db, {
      statementId: statement.id,
      newPaidMonth: "2026-08",
      reason: "Allocation raced.",
      confirmationKey: "race-alloc",
      previewToken: previewA.previewToken,
      initiator,
    })).rejects.toThrow(/no longer matches/);

    const previewB = await previewStatementPaidMonthChange(db, statement.id, "2026-08");
    await replaceTeamMembers(db, team.id, [
      { personKind: "agent", personId: john.id, shareBps: 8000, effectiveStart: "2026-08" },
      { personKind: "agent", personId: mo.id, shareBps: 2000, effectiveStart: "2026-08" },
    ], { requireComplete: true, closePrior: true });
    await expect(confirmStatementPaidMonthChange(db, {
      statementId: statement.id,
      newPaidMonth: "2026-08",
      reason: "Team raced.",
      confirmationKey: "race-team",
      previewToken: previewB.previewToken,
      initiator,
    })).rejects.toThrow(/no longer matches|different compensation terms/);

    const previewC = await previewStatementPaidMonthChange(db, statement.id, "2026-08");
    const payout = (await listPayoutsForCommission(db, posted.id)).find((row) => row.recipientType === "team_member")!;
    await db.update(commissionPayouts).set({ personName: "Changed Identity" }).where(eq(commissionPayouts.id, payout.id));
    await expect(confirmStatementPaidMonthChange(db, {
      statementId: statement.id,
      newPaidMonth: "2026-08",
      reason: "Payout raced.",
      confirmationKey: "race-payout",
      previewToken: previewC.previewToken,
      initiator,
    })).rejects.toThrow(/no longer matches/);
    expect((await getImportStatement(db, statement.id))?.paidMonth).toBe("2026-09");
    expect((await getCommission(db, posted.id))?.statementMonth).toBe("2026-09");
  });

  it("F. rejects same-carrier source rows with the wrong Group or amount", async () => {
    const db = await createTestDb();
    const carrier = await createCarrier(db, { name: "Anthem" });
    const relyon = await createGroup(db, { name: "RELYON" });
    const medical = await createLineOfBusiness(db, { name: "Medical" });
    const statementRow = await createImportStatement(db, {
      originalFilename: "wrong-row.csv",
      paidMonth: "2026-09",
      sourceType: "csv",
      status: "posted",
      fingerprint: fingerprintBuffer(new TextEncoder().encode("wrong-row")),
      carrierId: carrier.id,
      preview: preview([
        { key: "Commissions:43", group: "ACKEE HOLDING", amount: "33.33" },
        { key: "Commissions:44", group: "RELYON", amount: "10.00" },
      ]),
    });
    const commission = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: relyon.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 3333,
    });
    await expect(repairImportStatementLinkage(db, {
      commissionId: commission.id,
      importStatementId: statementRow.id,
      sourceRowKey: "Commissions:43",
    })).rejects.toThrow(/Group does not correspond/);
    await expect(repairImportStatementLinkage(db, {
      commissionId: commission.id,
      importStatementId: statementRow.id,
      sourceRowKey: "Commissions:44",
    })).rejects.toThrow(/amount does not correspond/);
    expect((await getCommission(db, commission.id))?.importStatementId).toBeNull();
  });

  it("G-I. blocks generic PATCH paid-month bypass and financial-identity edits when payouts exist", async () => {
    const { db, group, carrier, dental, statement } = await postedFixture("patch-safety");
    const otherGroup = await createGroup(db, { name: "Other Book" });
    const otherCarrier = await createCarrier(db, { name: "Other Carrier Patch" });
    const medical = await createLineOfBusiness(db, { name: "Medical" });
    const otherAgent = await createAgent(db, { name: "Replacement Agent" });
    const posted = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 5000,
      importStatementId: statement.id,
      sourceRowKey: "Commissions:1",
    });
    await expect(updateCommission(db, posted.id, { statementMonth: "2026-08" })).rejects.toThrow(/Change Paid Month/);
    await expect(updateCommission(db, posted.id, { grossCommissionCents: 6000 })).rejects.toThrow(/payout snapshots exist/);
    await expect(updateCommission(db, posted.id, { groupId: otherGroup.id })).rejects.toThrow(/payout snapshots exist/);
    await expect(updateCommission(db, posted.id, { carrierId: otherCarrier.id })).rejects.toThrow(/payout snapshots exist/);
    await expect(updateCommission(db, posted.id, { lineOfBusinessId: medical.id })).rejects.toThrow(/payout snapshots exist/);
    await expect(updateCommission(db, posted.id, { agentId: otherAgent.id })).rejects.toThrow(/payout snapshots exist/);
    const after = await getCommission(db, posted.id);
    expect(after?.statementMonth).toBe("2026-09");
    expect(after?.grossCommissionCents).toBe(5000);
    expect(after?.groupId).toBe(group.id);
    expect(after?.carrierId).toBe(carrier.id);
    expect(after?.lineOfBusinessId).toBe(dental.id);
    expect(after?.agentId).toBeNull();
  });

  it("J-K. Anthem repair fails closed on the exact requested set", async () => {
    const db = await createTestDb();
    const anthem = await createCarrier(db, { name: "Anthem" });
    const group = await createGroup(db, { name: "H & R LABOR CONTRACTING INC" });
    const rawMed = await createLineOfBusiness(db, { name: "MED" });
    const medical = await createLineOfBusiness(db, { name: "Medical" });
    const groupMedical = await createLineOfBusiness(db, { name: "Group Medical" });
    await createLineOfBusiness(db, { name: "Group Dental" });
    await createLineOfBusiness(db, { name: "Group Vision" });
    const target = await createImportStatement(db, {
      originalFilename: "anthem-target.csv",
      paidMonth: "2026-09",
      sourceType: "csv",
      status: "posted",
      fingerprint: fingerprintBuffer(new TextEncoder().encode("anthem-target")),
      carrierId: anthem.id,
      preview: preview(),
    });
    const other = await createImportStatement(db, {
      originalFilename: "anthem-other.csv",
      paidMonth: "2026-09",
      sourceType: "csv",
      status: "posted",
      fingerprint: fingerprintBuffer(new TextEncoder().encode("anthem-other")),
      carrierId: anthem.id,
      preview: preview(),
    });
    const posted = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: anthem.id,
      lineOfBusinessId: rawMed.id,
      grossCommissionCents: 35196,
      sourceCoverageLabel: "MED",
      importStatementId: target.id,
    });
    const outsider = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: anthem.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 1200,
      sourceCoverageLabel: "LIFE",
      importStatementId: other.id,
    });
    const beforePosted = await getCommission(db, posted.id);
    await expect(normalizePostedAnthemCoverage(db, {
      carrierId: anthem.id,
      commissionIds: [posted.id, outsider.id],
      importStatementId: target.id,
    })).rejects.toThrow(/not on the target statement|cannot be safely mapped/);
    expect((await getCommission(db, posted.id))?.lineOfBusinessId).toBe(beforePosted?.lineOfBusinessId);
    expect((await getCommission(db, outsider.id))?.lineOfBusinessId).toBe(medical.id);

    const result = await normalizePostedAnthemCoverage(db, {
      carrierId: anthem.id,
      commissionIds: [posted.id],
      importStatementId: target.id,
    });
    expect(result.remappedCommissionIds).toEqual([posted.id]);
    const after = await getCommission(db, posted.id);
    expect(after?.lineOfBusinessId).toBe(groupMedical.id);
    expect(after?.sourceLobLabel).toBe("MED");
    expect(after?.importStatementId).toBe(target.id);
    expect(after?.grossCommissionCents).toBe(35196);
    expect(after?.statementMonth).toBe("2026-09");
  });

  it("L. forced mid-transaction failures restore the original state", async () => {
    const { db, john, group, carrier, dental, statement } = await postedFixture("rollback");
    await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: dental.id,
      effectiveStart: "2026-01",
      entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }],
    });
    const posted = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 4400,
      importStatementId: statement.id,
      sourceRowKey: "Commissions:1",
    });
    const paidMonthPreview = await previewStatementPaidMonthChange(db, statement.id, "2026-08");
    setTransactionFailPoint("paid-month-after-statement");
    await expect(confirmStatementPaidMonthChange(db, {
      statementId: statement.id,
      newPaidMonth: "2026-08",
      reason: "Force rollback.",
      confirmationKey: "rollback-paid-month",
      previewToken: paidMonthPreview.previewToken,
      initiator,
    })).rejects.toThrow(/Forced transaction failure/);
    expect((await getImportStatement(db, statement.id))?.paidMonth).toBe("2026-09");
    expect((await getCommission(db, posted.id))?.statementMonth).toBe("2026-09");

    let canonicalHr = await createGroup(db, { name: "H&R Canonical" });
    while (canonicalHr.id < 29) {
      canonicalHr = await createGroup(db, { name: `H&R pad ${canonicalHr.id}` });
    }
    expect(canonicalHr.id).toBe(29);
    const sourceGroup = await createGroup(db, { name: "H&R source" });
    const hrRow = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: sourceGroup.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 700,
    });
    setTransactionFailPoint("hr-after-commission");
    await expect(repairHrLaborIdentity(db, { sourceGroupId: sourceGroup.id, canonicalGroupId: 29 })).rejects.toThrow(/Forced transaction failure/);
    expect((await getCommission(db, hrRow.id))?.groupId).toBe(sourceGroup.id);

    const anthem = await createCarrier(db, { name: "Anthem" });
    const rawMed = await createLineOfBusiness(db, { name: "MED" });
    await createLineOfBusiness(db, { name: "Group Medical" });
    await createLineOfBusiness(db, { name: "Group Dental" });
    await createLineOfBusiness(db, { name: "Group Vision" });
    const anthemRow = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: anthem.id,
      lineOfBusinessId: rawMed.id,
      grossCommissionCents: 1111,
      sourceCoverageLabel: "MED",
    });
    setTransactionFailPoint("anthem-after-update");
    await expect(normalizePostedAnthemCoverage(db, {
      carrierId: anthem.id,
      commissionIds: [anthemRow.id],
    })).rejects.toThrow(/Forced transaction failure/);
    expect((await getCommission(db, anthemRow.id))?.lineOfBusinessId).toBe(rawMed.id);

    const relyon = await createGroup(db, { name: "RELYON" });
    const linkStatement = await createImportStatement(db, {
      originalFilename: "link-rollback.csv",
      paidMonth: "2026-09",
      sourceType: "csv",
      status: "posted",
      fingerprint: fingerprintBuffer(new TextEncoder().encode("link-rollback")),
      carrierId: anthem.id,
      preview: preview([{ key: "Commissions:43", group: "RELYON", amount: "33.33" }]),
    });
    const unlinked = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: relyon.id,
      carrierId: anthem.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 3333,
    });
    setTransactionFailPoint("linkage-after-update");
    await expect(repairImportStatementLinkage(db, {
      commissionId: unlinked.id,
      importStatementId: linkStatement.id,
      sourceRowKey: "Commissions:43",
    })).rejects.toThrow(/Forced transaction failure/);
    expect((await getCommission(db, unlinked.id))?.importStatementId).toBeNull();

    const beforeCount = (await db.select().from(commissionRecords)).length;
    setTransactionFailPoint("header-payout-after-header");
    await expect(createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 250,
    })).rejects.toThrow(/Forced transaction failure/);
    expect(await db.select().from(commissionRecords)).toHaveLength(beforeCount);

    const original = await getCommission(db, posted.id);
    const originalPayouts = await listPayoutsForCommission(db, posted.id);
    expect(originalPayouts.length).toBeGreaterThan(0);
    setTransactionFailPoint("update-commission-after-header");
    await expect(updateCommission(db, posted.id, { notes: "should not persist" })).rejects.toThrow(/Forced transaction failure: update-commission-after-header/);
    const restored = await getCommission(db, posted.id);
    expect(restored).toEqual(original);
    expect(await listPayoutsForCommission(db, posted.id)).toEqual(originalPayouts);
    expect(restored?.notes).toBeNull();
    expect(restored?.grossCommissionCents).toBe(original?.grossCommissionCents);
    expect(restored?.agentCompensationCents).toBe(original?.agentCompensationCents);
    expect(restored?.agencyNetCents).toBe(original?.agencyNetCents);
  });

  it("blocks a new applicable allocation from slipping into paid-month confirmation", async () => {
    const { db, john, group, carrier, dental, statement } = await postedFixture("phantom-allocation");
    const posted = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 2500,
      importStatementId: statement.id,
      sourceRowKey: "Commissions:1",
    });
    const first = await previewStatementPaidMonthChange(db, statement.id, "2026-08");
    expect(first.confirmable).toBe(true);
    expect(first.items[0]?.impactClass).toBe("equivalent_terms");

    let heldLocks: Array<{ classid: number; objid: number }> = [];
    setAfterAllocationNamespaceLock(async (lockedDb) => {
      const result = await (lockedDb as typeof db).execute(sql`
        SELECT classid::int AS classid, objid::int AS objid
        FROM pg_locks
        WHERE locktype = 'advisory' AND granted
      `) as unknown as { rows?: Array<{ classid: number; objid: number }> };
      heldLocks = result.rows ?? [];
    });
    await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: dental.id,
      effectiveStart: "2026-01",
      entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }],
    });
    await expect(confirmStatementPaidMonthChange(db, {
      statementId: statement.id,
      newPaidMonth: "2026-08",
      reason: "Phantom allocation must not commit.",
      confirmationKey: "phantom-alloc",
      previewToken: first.previewToken,
      initiator,
    })).rejects.toThrow(/no longer matches|different compensation terms/);
    expect(heldLocks.some((lock) => lock.classid === group.id && lock.objid === dental.id)).toBe(true);
    expect((await getImportStatement(db, statement.id))?.paidMonth).toBe("2026-09");
    expect((await getCommission(db, posted.id))?.statementMonth).toBe("2026-09");
  });
});
