import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createAgent } from "./agents";
import { createAllocation, updateAllocation } from "./allocations";
import { createCarrier } from "./carriers";
import { createCommission, getCommission, type CommissionView } from "./commissions";
import { confirmCompensationCorrection, previewCompensationCorrection } from "./compensationCorrections";
import { createGroup } from "./groups";
import { createLineOfBusiness } from "./linesOfBusiness";
import { listPayoutsForCommission, type PayoutView } from "./payouts";
import { buildAgencyReport, buildIndividualReport, buildTeamReport } from "./reports";
import { confirmStatementPaidMonthChange, previewStatementPaidMonthChange } from "./statementPaidMonthChange";
import { createImportStatement, getImportStatement } from "./statements";
import { createTeam, replaceTeamMembers } from "./teams";
import { setTransactionFailPoint } from "./transactionTestHook";
import { createTestDb } from "@/db/test-db";
import { commissionPayouts, commissionRecords, statementPaidMonthChanges } from "@/db/schema";
import { fingerprintBuffer } from "@/domain/fingerprint";
import type { StatementPreview } from "@/domain/workbook";

const initiator = { id: "user-1", email: "mo@example.com", name: "Mo Murillo" };
const CAL_CHOICE_GROSS = 156123;

afterEach(() => {
  setTransactionFailPoint(null);
});

function preview(): StatementPreview {
  return {
    sheets: [{
      name: "Commissions",
      headerRowNumber: 1,
      rowCount: 2,
      headers: ["Group", "Commission"],
      groupNameHeader: "Group",
      groupNumberHeader: null,
      premiumMonthHeader: null,
      rows: [
        { rowNumber: 1, values: { Group: "Acme", Commission: "100.00" }, premiumMonth: null, group: { status: "matched", groupId: null, groupName: "Acme", sourceName: "Acme", sourceNumber: null }, sourceIdentity: "Commissions:1" },
        { rowNumber: 2, values: { Group: "Acme", Commission: "50.00" }, premiumMonth: null, group: { status: "matched", groupId: null, groupName: "Acme", sourceName: "Acme", sourceNumber: null }, sourceIdentity: "Commissions:2" },
      ],
    }],
    unmatchedGroups: [],
    rowCount: 2,
    newGroupCount: 0,
  };
}

function distribute(count: number, total: number) {
  const base = Math.trunc(total / count);
  const values = Array.from({ length: count }, () => base);
  values[values.length - 1] += total - base * count;
  return values;
}

function headerIdentity(row: CommissionView) {
  const { statementMonth: _statementMonth, updatedAt: _updatedAt, ...rest } = row;
  return rest;
}

function payoutIdentity(rows: PayoutView[]) {
  return [...rows]
    .map((row) => ({
      id: row.id,
      commissionId: row.commissionId,
      allocationId: row.allocationId,
      recipientType: row.recipientType,
      personKind: row.personKind,
      personId: row.personId,
      personName: row.personName,
      teamId: row.teamId,
      teamName: row.teamName,
      parentPayoutId: row.parentPayoutId,
      allocationBps: row.allocationBps,
      teamInternalBps: row.teamInternalBps,
      compensationCents: row.compensationCents,
      createdAt: row.createdAt,
    }))
    .sort((left, right) => left.id - right.id);
}

async function postedStatement(db: Awaited<ReturnType<typeof createTestDb>>, seed: string, extras: { paidMonth?: string; displayName?: string; originalFilename?: string } = {}) {
  const group = await createGroup(db, { name: "Acme Benefits" });
  const carrier = await createCarrier(db, { name: "Principal" });
  const dental = await createLineOfBusiness(db, { name: "Dental" });
  const statement = await createImportStatement(db, {
    originalFilename: extras.originalFilename ?? `${seed}.csv`,
    displayName: extras.displayName ?? "Principal September",
    paidMonth: extras.paidMonth ?? "2026-09",
    carrierId: carrier.id,
    sourceType: "csv",
    status: "posted",
    fingerprint: fingerprintBuffer(new TextEncoder().encode(seed)),
    preview: preview(),
  });
  return { group, carrier, dental, statement };
}

async function snapshotStatement(db: Awaited<ReturnType<typeof createTestDb>>, statementId: number, commissionIds: number[]) {
  const statement = await getImportStatement(db, statementId);
  const commissions = [];
  const payouts = [];
  for (const id of commissionIds) {
    const commission = await getCommission(db, id);
    if (commission) commissions.push(commission);
    payouts.push(...await listPayoutsForCommission(db, id));
  }
  return {
    statement: {
      id: statement?.id,
      originalFilename: statement?.originalFilename,
      displayName: statement?.displayName,
      fingerprint: statement?.fingerprint,
      status: statement?.status,
      carrierId: statement?.carrierId,
    },
    headers: commissions.map(headerIdentity),
    payouts: payoutIdentity(payouts),
    gross: commissions.reduce((sum, row) => sum + row.grossCommissionCents, 0),
  };
}

describe("posted statement Change Paid Month", () => {
  it("moves an unsettled posted statement from September to August without delete, re-upload, or money changes", async () => {
    const db = await createTestDb();
    const { group, carrier, dental, statement } = await postedStatement(db, "unsettled-move");
    const first = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 10000,
      premiumMonth: "2026-07",
      importStatementId: statement.id,
      sourceRowKey: "Commissions:1",
      sourceGroupLabel: "Acme",
      sourceLobLabel: "Dental",
    });
    const second = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 5000,
      premiumMonth: "2026-07",
      importStatementId: statement.id,
      sourceRowKey: "Commissions:2",
    });
    await db.delete(commissionPayouts).where(eq(commissionPayouts.commissionId, first.id));
    await db.delete(commissionPayouts).where(eq(commissionPayouts.commissionId, second.id));
    const originalFile = (await getImportStatement(db, statement.id))?.originalFilename;

    const previewImpact = await previewStatementPaidMonthChange(db, statement.id, "2026-08");
    expect(previewImpact.confirmable).toBe(true);
    expect(previewImpact.payoutCorrectionRequired).toBe(false);
    expect(previewImpact.commissionCount).toBe(2);
    expect(previewImpact.grossAffectedCents).toBe(15000);
    expect(previewImpact.payoutCount).toBe(0);

    const confirmed = await confirmStatementPaidMonthChange(db, {
      statementId: statement.id,
      newPaidMonth: "2026-08",
      reason: "Agency received this statement in August.",
      confirmationKey: "paid-month-1",
      previewToken: previewImpact.previewToken,
      initiator,
    });
    expect(confirmed.replayed).toBe(false);
    expect(confirmed.payoutCorrectionRequired).toBe(false);
    expect(confirmed.payoutCorrectionPerformed).toBe(false);

    const moved = await getImportStatement(db, statement.id);
    expect(moved?.id).toBe(statement.id);
    expect(moved?.paidMonth).toBe("2026-08");
    expect(moved?.originalFilename).toBe(originalFile);
    expect(moved?.status).toBe("posted");
    expect(await db.select().from(commissionRecords)).toHaveLength(2);
    expect((await getCommission(db, first.id))?.statementMonth).toBe("2026-08");
    expect((await getCommission(db, second.id))?.statementMonth).toBe("2026-08");
    expect((await getCommission(db, first.id))?.premiumMonth).toBe("2026-07");
    expect((await getCommission(db, first.id))?.grossCommissionCents).toBe(10000);
    expect((await getCommission(db, first.id))?.sourceRowKey).toBe("Commissions:1");
    expect((await getCommission(db, first.id))?.sourceLobLabel).toBe("Dental");

    const september = await buildAgencyReport(db, { kind: "agency", paidMonth: "2026-09" });
    const august = await buildAgencyReport(db, { kind: "agency", paidMonth: "2026-08" });
    expect(september.rows).toHaveLength(0);
    expect(august.rows).toHaveLength(2);
    expect(august.totals.grossCommissionCents).toBe(15000);

    const replay = await confirmStatementPaidMonthChange(db, {
      statementId: statement.id,
      newPaidMonth: "2026-08",
      reason: "Agency received this statement in August.",
      confirmationKey: "paid-month-1",
      previewToken: previewImpact.previewToken,
      initiator,
    });
    expect(replay.replayed).toBe(true);
    expect(replay.auditId).toBe(confirmed.auditId);
    expect(await db.select().from(statementPaidMonthChanges)).toHaveLength(1);
  });

  it("allows a Cal Choice 17-row $1,561.23 move to August with no destination allocation", async () => {
    const db = await createTestDb();
    const john = await createAgent(db, { name: "John Elizando" });
    const mo = await createAgent(db, { name: "Mo Murillo" });
    const groupA = await createGroup(db, { name: "Cal Choice Medical Book" });
    const groupB = await createGroup(db, { name: "Cal Choice Dental Book" });
    const carrier = await createCarrier(db, { name: "CaliforniaChoice" });
    const medical = await createLineOfBusiness(db, { name: "Medical" });
    const dental = await createLineOfBusiness(db, { name: "Dental" });
    const team = await createTeam(db, {
      name: "Cal Choice Producers",
      members: [
        { personKind: "agent", personId: john.id, shareBps: 7000, effectiveStart: "2026-09", effectiveEnd: "2026-09" },
        { personKind: "agent", personId: mo.id, shareBps: 3000, effectiveStart: "2026-09", effectiveEnd: "2026-09" },
      ],
    });
    await createAllocation(db, {
      groupId: groupA.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2026-09",
      effectiveEnd: "2026-09",
      entries: [{ recipientType: "team", teamId: team.id, compensationBps: 10000 }],
    });
    await createAllocation(db, {
      groupId: groupB.id,
      lineOfBusinessId: dental.id,
      effectiveStart: "2026-09",
      effectiveEnd: "2026-09",
      entries: [
        { recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 5000 },
        { recipientType: "agency", compensationBps: 5000 },
      ],
    });
    const statement = await createImportStatement(db, {
      originalFilename: "Cal Choice - 08 2026.pdf",
      displayName: "Cal Choice - 08 2026.pdf",
      paidMonth: "2026-09",
      carrierId: carrier.id,
      sourceType: "pdf",
      status: "posted",
      fingerprint: fingerprintBuffer(new TextEncoder().encode("cal-choice-17")),
      preview: preview(),
    });
    const amounts = distribute(17, CAL_CHOICE_GROSS);
    const created = [];
    for (const [index, amount] of amounts.entries()) {
      const teamRow = index < 10;
      created.push(await createCommission(db, {
        statementMonth: "2026-09",
        groupId: teamRow ? groupA.id : groupB.id,
        carrierId: carrier.id,
        lineOfBusinessId: teamRow ? medical.id : dental.id,
        grossCommissionCents: amount,
        premiumMonth: "2026-08",
        sourcePeriodLabel: "08-26",
        sourceGroupLabel: teamRow ? "Cal Choice Medical Book" : "Cal Choice Dental Book",
        sourceLobLabel: teamRow ? "Medical" : "Dental",
        sourceCoverageLabel: teamRow ? "MED" : "DEN",
        importStatementId: statement.id,
        sourceRowKey: `CalChoice:${index + 1}`,
      }));
    }
    const before = await snapshotStatement(db, statement.id, created.map((row) => row.id));
    expect(created).toHaveLength(17);
    expect(before.gross).toBe(CAL_CHOICE_GROSS);
    expect(before.payouts).toHaveLength(44);

    const previewImpact = await previewStatementPaidMonthChange(db, statement.id, "2026-08");
    expect(previewImpact.confirmable).toBe(true);
    expect(previewImpact.payoutCorrectionRequired).toBe(false);
    expect(previewImpact.commissionCount).toBe(17);
    expect(previewImpact.grossAffectedCents).toBe(CAL_CHOICE_GROSS);
    expect(previewImpact.payoutCount).toBe(44);

    const confirmed = await confirmStatementPaidMonthChange(db, {
      statementId: statement.id,
      newPaidMonth: "2026-08",
      reason: "Upload incorrect",
      confirmationKey: "cal-choice-paid-month",
      previewToken: previewImpact.previewToken,
      initiator,
    });
    expect(confirmed.payoutCorrectionRequired).toBe(false);
    expect(confirmed.payoutCorrectionPerformed).toBe(false);

    const after = await snapshotStatement(db, statement.id, created.map((row) => row.id));
    expect(after.headers).toEqual(before.headers);
    expect(after.payouts).toEqual(before.payouts);
    expect(after.gross).toBe(CAL_CHOICE_GROSS);
    expect(after.statement).toEqual(before.statement);
    expect((await getImportStatement(db, statement.id))?.paidMonth).toBe("2026-08");
    expect((await db.select().from(commissionRecords)).every((row) => row.statementMonth === "2026-08")).toBe(true);

    const septemberAgency = await buildAgencyReport(db, { kind: "agency", paidMonth: "2026-09" });
    const augustAgency = await buildAgencyReport(db, { kind: "agency", paidMonth: "2026-08" });
    expect(septemberAgency.rows).toHaveLength(0);
    expect(augustAgency.rows).toHaveLength(17);
    expect(augustAgency.totals.grossCommissionCents).toBe(CAL_CHOICE_GROSS);

    const johnSeptember = await buildIndividualReport(db, { kind: "individual", paidMonth: "2026-09", personKind: "agent", personId: john.id });
    const johnAugust = await buildIndividualReport(db, { kind: "individual", paidMonth: "2026-08", personKind: "agent", personId: john.id });
    expect(johnSeptember.rows).toHaveLength(0);
    expect(johnAugust.totals.compensationCents).toBeGreaterThan(0);

    const teamSeptember = await buildTeamReport(db, { kind: "team", paidMonth: "2026-09", teamId: team.id });
    const teamAugust = await buildTeamReport(db, { kind: "team", paidMonth: "2026-08", teamId: team.id });
    expect(teamSeptember.rows).toHaveLength(0);
    expect(teamAugust.rows.length).toBeGreaterThan(0);

    const [audit] = await db.select().from(statementPaidMonthChanges);
    expect(audit.oldPaidMonth).toBe("2026-09");
    expect(audit.newPaidMonth).toBe("2026-08");
    expect(audit.commissionCount).toBe(17);
    expect(audit.grossAffectedCents).toBe(CAL_CHOICE_GROSS);
    expect(audit.payoutCorrectionRequired).toBe(0);
    expect(audit.payoutCorrectionPerformed).toBe(0);
    expect(JSON.parse(audit.impactClassificationJson)).toMatchObject({
      financialSnapshotsPreserved: true,
      compensationRecalculation: "none",
      payoutCount: 44,
      payoutCorrectionRequired: false,
      payoutCorrectionPerformed: false,
    });
  });

  it("allows a move when the destination month has a different allocation and does not recalculate", async () => {
    const db = await createTestDb();
    const john = await createAgent(db, { name: "John Elizondo" });
    const mo = await createAgent(db, { name: "Mo Murillo" });
    const { group, carrier, dental, statement } = await postedStatement(db, "different-alloc");
    await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: dental.id,
      effectiveStart: "2026-09",
      effectiveEnd: "2026-09",
      entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }],
    });
    await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: dental.id,
      effectiveStart: "2026-08",
      effectiveEnd: "2026-08",
      entries: [{ recipientType: "person", personKind: "agent", personId: mo.id, compensationBps: 10000 }],
    });
    const settled = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 9000,
      importStatementId: statement.id,
      sourceRowKey: "Commissions:1",
    });
    const beforePayouts = payoutIdentity(await listPayoutsForCommission(db, settled.id));
    const beforeHeader = headerIdentity((await getCommission(db, settled.id))!);
    const previewImpact = await previewStatementPaidMonthChange(db, statement.id, "2026-08");
    expect(previewImpact.confirmable).toBe(true);
    await confirmStatementPaidMonthChange(db, {
      statementId: statement.id,
      newPaidMonth: "2026-08",
      reason: "Paid month correction only.",
      confirmationKey: "diff-alloc",
      previewToken: previewImpact.previewToken,
      initiator,
    });
    expect(headerIdentity((await getCommission(db, settled.id))!)).toEqual(beforeHeader);
    expect(payoutIdentity(await listPayoutsForCommission(db, settled.id))).toEqual(beforePayouts);
    expect((await buildIndividualReport(db, { kind: "individual", paidMonth: "2026-08", personKind: "agent", personId: john.id })).totals.compensationCents).toBe(9000);
    expect((await buildIndividualReport(db, { kind: "individual", paidMonth: "2026-08", personKind: "agent", personId: mo.id })).rows).toHaveLength(0);
  });

  it("allows a move when effective Team membership differs and does not recalculate", async () => {
    const db = await createTestDb();
    const john = await createAgent(db, { name: "John Elizondo" });
    const mo = await createAgent(db, { name: "Mo Murillo" });
    const { group, carrier, dental, statement } = await postedStatement(db, "different-team");
    const team = await createTeam(db, {
      name: "Producers",
      members: [
        { personKind: "agent", personId: john.id, shareBps: 7000, effectiveStart: "2026-01" },
        { personKind: "agent", personId: mo.id, shareBps: 3000, effectiveStart: "2026-01" },
      ],
    });
    await replaceTeamMembers(db, team.id, [
      { personKind: "agent", personId: john.id, shareBps: 10000, effectiveStart: "2026-09" },
    ], { requireComplete: true, closePrior: true });
    await createAllocation(db, {
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
      grossCommissionCents: 10000,
      importStatementId: statement.id,
      sourceRowKey: "Commissions:1",
    });
    const beforePayouts = payoutIdentity(await listPayoutsForCommission(db, posted.id));
    expect(beforePayouts.some((row) => row.recipientType === "team_member" && row.personId === john.id && row.teamInternalBps === 10000)).toBe(true);
    const previewImpact = await previewStatementPaidMonthChange(db, statement.id, "2026-08");
    expect(previewImpact.confirmable).toBe(true);
    await confirmStatementPaidMonthChange(db, {
      statementId: statement.id,
      newPaidMonth: "2026-08",
      reason: "Team config is not an input.",
      confirmationKey: "diff-team",
      previewToken: previewImpact.previewToken,
      initiator,
    });
    expect(payoutIdentity(await listPayoutsForCommission(db, posted.id))).toEqual(beforePayouts);
    expect((await getCommission(db, posted.id))?.statementMonth).toBe("2026-08");
  });

  it("does not invalidate confirmation when allocation or Team config changes after preview", async () => {
    const db = await createTestDb();
    const john = await createAgent(db, { name: "John Elizondo" });
    const mo = await createAgent(db, { name: "Mo Murillo" });
    const { group, carrier, dental, statement } = await postedStatement(db, "config-after-preview");
    const team = await createTeam(db, {
      name: "Config Team",
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
      grossCommissionCents: 8000,
      importStatementId: statement.id,
      sourceRowKey: "Commissions:1",
    });
    const beforePayouts = payoutIdentity(await listPayoutsForCommission(db, posted.id));
    const previewImpact = await previewStatementPaidMonthChange(db, statement.id, "2026-08");
    await updateAllocation(db, allocation.id, { status: "inactive" });
    await replaceTeamMembers(db, team.id, [
      { personKind: "agent", personId: john.id, shareBps: 5000, effectiveStart: "2026-09" },
      { personKind: "agent", personId: mo.id, shareBps: 5000, effectiveStart: "2026-09" },
    ], { requireComplete: true, closePrior: true });
    await confirmStatementPaidMonthChange(db, {
      statementId: statement.id,
      newPaidMonth: "2026-08",
      reason: "Config changes are irrelevant.",
      confirmationKey: "config-after",
      previewToken: previewImpact.previewToken,
      initiator,
    });
    expect((await getImportStatement(db, statement.id))?.paidMonth).toBe("2026-08");
    expect(payoutIdentity(await listPayoutsForCommission(db, posted.id))).toEqual(beforePayouts);
  });

  it("rejects stale payout, header, identity, source, and population changes", async () => {
    const db = await createTestDb();
    const john = await createAgent(db, { name: "John Elizondo" });
    const { carrier, dental } = await postedStatement(db, "stale-base");
    const otherGroup = await createGroup(db, { name: "Other Book" });
    const otherCarrier = await createCarrier(db, { name: "Other Carrier" });
    const medical = await createLineOfBusiness(db, { name: "Medical" });
    const mutations: Array<{ kind: string; mutate: (postedId: number, statementId: number) => Promise<void> }> = [
      { kind: "payout", mutate: async (postedId) => {
        const payout = (await listPayoutsForCommission(db, postedId))[0];
        await db.update(commissionPayouts).set({ compensationCents: payout.compensationCents + 1 }).where(eq(commissionPayouts.id, payout.id));
      } },
      { kind: "header", mutate: async (postedId) => {
        const current = await getCommission(db, postedId);
        await db.update(commissionRecords).set({
          compensationBps: 5000,
          agentCompensationCents: (current?.agentCompensationCents ?? 0) + 1,
          agencyNetCents: (current?.agencyNetCents ?? 0) - 1,
        }).where(eq(commissionRecords.id, postedId));
      } },
      { kind: "group", mutate: async (postedId) => { await db.update(commissionRecords).set({ groupId: otherGroup.id }).where(eq(commissionRecords.id, postedId)); } },
      { kind: "carrier", mutate: async (postedId) => { await db.update(commissionRecords).set({ carrierId: otherCarrier.id }).where(eq(commissionRecords.id, postedId)); } },
      { kind: "lob", mutate: async (postedId) => { await db.update(commissionRecords).set({ lineOfBusinessId: medical.id }).where(eq(commissionRecords.id, postedId)); } },
      { kind: "coverage", mutate: async (postedId) => { await db.update(commissionRecords).set({ premiumMonth: "2026-06", sourcePeriodLabel: "06-26" }).where(eq(commissionRecords.id, postedId)); } },
      { kind: "population", mutate: async (_postedId, statementId) => {
        const statement = await getImportStatement(db, statementId);
        await createCommission(db, {
          statementMonth: "2026-09",
          groupId: statement ? (await getCommission(db, _postedId))!.groupId : otherGroup.id,
          carrierId: carrier.id,
          lineOfBusinessId: dental.id,
          grossCommissionCents: 300,
          importStatementId: statementId,
          sourceRowKey: "Commissions:2",
        });
      } },
    ];

    for (const [index, { kind, mutate }] of mutations.entries()) {
      const book = await createGroup(db, { name: `Stale ${kind}` });
      const statement = await createImportStatement(db, {
        originalFilename: `stale-${kind}.csv`,
        paidMonth: "2026-09",
        carrierId: carrier.id,
        sourceType: "csv",
        status: "posted",
        fingerprint: fingerprintBuffer(new TextEncoder().encode(`stale-${kind}`)),
        preview: preview(),
      });
      await createAllocation(db, {
        groupId: book.id,
        lineOfBusinessId: dental.id,
        effectiveStart: "2026-01",
        entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }],
      });
      const posted = await createCommission(db, {
        statementMonth: "2026-09",
        groupId: book.id,
        carrierId: carrier.id,
        lineOfBusinessId: dental.id,
        grossCommissionCents: 2200 + index,
        premiumMonth: "2026-07",
        importStatementId: statement.id,
        sourceRowKey: "Commissions:1",
      });
      const first = await previewStatementPaidMonthChange(db, statement.id, "2026-08");
      await mutate(posted.id, statement.id);
      await expect(confirmStatementPaidMonthChange(db, {
        statementId: statement.id,
        newPaidMonth: "2026-08",
        reason: `Stale ${kind}.`,
        confirmationKey: `stale-${kind}`,
        previewToken: first.previewToken,
        initiator,
      })).rejects.toThrow(/no longer matches/);
      expect((await getImportStatement(db, statement.id))?.paidMonth).toBe("2026-09");
      expect((await getCommission(db, posted.id))?.statementMonth).toBe("2026-09");
    }
  });

  it("rolls back the entire Paid Month move on forced transaction failure", async () => {
    const db = await createTestDb();
    const { group, carrier, dental, statement } = await postedStatement(db, "rollback");
    const posted = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 4400,
      importStatementId: statement.id,
      sourceRowKey: "Commissions:1",
    });
    const before = await snapshotStatement(db, statement.id, [posted.id]);
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
    expect(await snapshotStatement(db, statement.id, [posted.id])).toEqual(before);
    setTransactionFailPoint(null);
  });

  it("preserves mixed team, person, chargeback, and corrected payouts without rewriting them", async () => {
    const db = await createTestDb();
    const john = await createAgent(db, { name: "John Elizondo" });
    const mo = await createAgent(db, { name: "Mo Murillo" });
    const carrier = await createCarrier(db, { name: "ChoiceBuilder" });
    const medical = await createLineOfBusiness(db, { name: "Medical" });
    const teamGroup = await createGroup(db, { name: "Team Group" });
    const personGroup = await createGroup(db, { name: "Person Group" });
    const chargeGroup = await createGroup(db, { name: "Chargeback Group" });
    const correctedGroup = await createGroup(db, { name: "Corrected Group" });
    const team = await createTeam(db, {
      name: "Producers",
      members: [
        { personKind: "agent", personId: john.id, shareBps: 7000, effectiveStart: "2026-01" },
        { personKind: "agent", personId: mo.id, shareBps: 3000, effectiveStart: "2026-01" },
      ],
    });
    await createAllocation(db, {
      groupId: teamGroup.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2026-01",
      entries: [{ recipientType: "team", teamId: team.id, compensationBps: 10000 }],
    });
    await createAllocation(db, {
      groupId: personGroup.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2026-01",
      entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }],
    });
    await createAllocation(db, {
      groupId: chargeGroup.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2026-01",
      entries: [{ recipientType: "agency", compensationBps: 10000 }],
    });
    const statement = await createImportStatement(db, {
      originalFilename: "mixed.csv",
      paidMonth: "2026-09",
      carrierId: carrier.id,
      sourceType: "csv",
      status: "posted",
      fingerprint: fingerprintBuffer(new TextEncoder().encode("mixed-paid-month")),
      preview: preview(),
    });
    const teamRow = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: teamGroup.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 10000,
      importStatementId: statement.id,
      sourceRowKey: "Commissions:1",
    });
    const personRow = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: personGroup.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 2500,
      importStatementId: statement.id,
      sourceRowKey: "Commissions:2",
    });
    const chargeback = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: chargeGroup.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: -400,
      importStatementId: statement.id,
      sourceRowKey: "team-charge",
    });
    const fallback = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: correctedGroup.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 3000,
    });
    await createAllocation(db, {
      groupId: correctedGroup.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2026-01",
      entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }],
    });
    const correctionPreview = await previewCompensationCorrection(db, [fallback.id]);
    await confirmCompensationCorrection(db, {
      commissionIds: [fallback.id],
      reason: "Restore known historical terms.",
      confirmationKey: "corr-1",
      previewToken: correctionPreview.previewToken!,
      initiator,
    });

    const teamPayouts = payoutIdentity(await listPayoutsForCommission(db, teamRow.id));
    const impact = await previewStatementPaidMonthChange(db, statement.id, "2026-08");
    expect(impact.confirmable).toBe(true);
    await confirmStatementPaidMonthChange(db, {
      statementId: statement.id,
      newPaidMonth: "2026-08",
      reason: "Received in August.",
      confirmationKey: "mixed-1",
      previewToken: impact.previewToken,
      initiator,
    });
    expect(payoutIdentity(await listPayoutsForCommission(db, teamRow.id))).toEqual(teamPayouts);
    expect((await getCommission(db, chargeback.id))?.grossCommissionCents).toBe(-400);
    expect((await getCommission(db, personRow.id))?.statementMonth).toBe("2026-08");
    expect((await getCommission(db, fallback.id))?.statementMonth).toBe("2026-09");
    const teamReport = await buildTeamReport(db, { kind: "team", paidMonth: "2026-08", teamId: team.id });
    expect(teamReport.rows.some((row) => row.grossCommissionCents === 10000)).toBe(true);
  });

  it("protects concurrent confirmation by binding the preview to current financial/source state", async () => {
    const db = await createTestDb();
    const { group, carrier, dental, statement } = await postedStatement(db, "concurrent");
    const posted = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 1100,
      importStatementId: statement.id,
      sourceRowKey: "Commissions:1",
    });
    const first = await previewStatementPaidMonthChange(db, statement.id, "2026-08");
    const second = await previewStatementPaidMonthChange(db, statement.id, "2026-07");
    await confirmStatementPaidMonthChange(db, {
      statementId: statement.id,
      newPaidMonth: "2026-08",
      reason: "First confirm wins.",
      confirmationKey: "concurrent-1",
      previewToken: first.previewToken,
      initiator,
    });
    await expect(confirmStatementPaidMonthChange(db, {
      statementId: statement.id,
      newPaidMonth: "2026-07",
      reason: "Second confirm is stale.",
      confirmationKey: "concurrent-2",
      previewToken: second.previewToken,
      initiator,
    })).rejects.toThrow(/no longer matches|different paid month|current statement/);
    expect((await getImportStatement(db, statement.id))?.paidMonth).toBe("2026-08");
    expect((await getCommission(db, posted.id))?.statementMonth).toBe("2026-08");
    expect(await db.select().from(commissionRecords)).toHaveLength(1);
  });
});
