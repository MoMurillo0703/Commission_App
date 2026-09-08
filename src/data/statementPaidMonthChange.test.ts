import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createAgent } from "./agents";
import { createAllocation } from "./allocations";
import { createCarrier } from "./carriers";
import { createCommission, getCommission } from "./commissions";
import { confirmCompensationCorrection, previewCompensationCorrection } from "./compensationCorrections";
import { createGroup } from "./groups";
import { createLineOfBusiness } from "./linesOfBusiness";
import { listPayoutsForCommission } from "./payouts";
import { buildAgencyReport, buildIndividualReport, buildTeamReport } from "./reports";
import { confirmStatementPaidMonthChange, previewStatementPaidMonthChange } from "./statementPaidMonthChange";
import { createImportStatement, getImportStatement } from "./statements";
import { createTeam } from "./teams";
import { createTestDb } from "@/db/test-db";
import { commissionPayouts, commissionRecords, statementPaidMonthChanges } from "@/db/schema";
import { fingerprintBuffer } from "@/domain/fingerprint";
import type { StatementPreview } from "@/domain/workbook";

const initiator = { id: "user-1", email: "mo@example.com", name: "Mo Murillo" };

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

async function postedStatement(db: Awaited<ReturnType<typeof createTestDb>>, seed: string) {
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
  return { group, carrier, dental, statement };
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
    expect(previewImpact.items.every((item) => item.impactClass === "unsettled")).toBe(true);
    expect(previewImpact.commissionCount).toBe(2);
    expect(previewImpact.grossAffectedCents).toBe(15000);

    const confirmed = await confirmStatementPaidMonthChange(db, {
      statementId: statement.id,
      newPaidMonth: "2026-08",
      reason: "Agency received this statement in August.",
      confirmationKey: "paid-month-1",
      previewToken: previewImpact.previewToken,
      initiator,
    });
    expect(confirmed.replayed).toBe(false);
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

  it("keeps equivalent settled terms and blocks different or missing allocations", async () => {
    const db = await createTestDb();
    const john = await createAgent(db, { name: "John Elizondo" });
    const { group, carrier, dental, statement } = await postedStatement(db, "settled-terms");
    await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: dental.id,
      effectiveStart: "2026-01",
      effectiveEnd: "2026-12",
      entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }],
    });
    const settled = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 8000,
      premiumMonth: "2026-06",
      importStatementId: statement.id,
      sourceRowKey: "Commissions:1",
    });
    const payouts = await listPayoutsForCommission(db, settled.id);
    expect(payouts.some((row) => row.recipientType === "person")).toBe(true);

    const equivalent = await previewStatementPaidMonthChange(db, statement.id, "2026-08");
    expect(equivalent.items[0]?.impactClass).toBe("equivalent_terms");
    expect(equivalent.confirmable).toBe(true);
    await confirmStatementPaidMonthChange(db, {
      statementId: statement.id,
      newPaidMonth: "2026-08",
      reason: "Same terms cover August.",
      confirmationKey: "equiv-1",
      previewToken: equivalent.previewToken,
      initiator,
    });
    expect((await getCommission(db, settled.id))?.statementMonth).toBe("2026-08");
    expect(await listPayoutsForCommission(db, settled.id)).toEqual(payouts);
    expect((await buildIndividualReport(db, {
      kind: "individual",
      paidMonth: "2026-08",
      personKind: "agent",
      personId: john.id,
    })).totals.compensationCents).toBe(8000);
    expect((await buildIndividualReport(db, {
      kind: "individual",
      paidMonth: "2026-09",
      personKind: "agent",
      personId: john.id,
    })).rows).toHaveLength(0);
  });

  it("blocks settled rows when the new month selects different terms or no allocation", async () => {
    const db = await createTestDb();
    const john = await createAgent(db, { name: "John Elizondo" });
    const mo = await createAgent(db, { name: "Mo Murillo" });
    const { group, carrier, dental, statement } = await postedStatement(db, "different-terms");
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
    const before = await getImportStatement(db, statement.id);
    const different = await previewStatementPaidMonthChange(db, statement.id, "2026-08");
    expect(different.items[0]?.impactClass).toBe("different_terms");
    expect(different.confirmable).toBe(false);
    await expect(confirmStatementPaidMonthChange(db, {
      statementId: statement.id,
      newPaidMonth: "2026-08",
      reason: "Should not silently recalculate.",
      confirmationKey: "diff-1",
      previewToken: different.previewToken,
      initiator,
    })).rejects.toThrow(/different compensation terms/);
    expect((await getImportStatement(db, statement.id))?.paidMonth).toBe(before?.paidMonth);
    expect((await getCommission(db, settled.id))?.statementMonth).toBe("2026-09");

    const otherGroup = await createGroup(db, { name: "No August Plan" });
    const otherStatement = await createImportStatement(db, {
      originalFilename: "no-alloc.csv",
      paidMonth: "2026-09",
      carrierId: carrier.id,
      sourceType: "csv",
      status: "posted",
      fingerprint: fingerprintBuffer(new TextEncoder().encode("no-alloc")),
      preview: preview(),
    });
    await createAllocation(db, {
      groupId: otherGroup.id,
      lineOfBusinessId: dental.id,
      effectiveStart: "2026-09",
      entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }],
    });
    await createCommission(db, {
      statementMonth: "2026-09",
      groupId: otherGroup.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 4000,
      importStatementId: otherStatement.id,
      sourceRowKey: "Commissions:1",
    });
    const missing = await previewStatementPaidMonthChange(db, otherStatement.id, "2026-08");
    expect(missing.items[0]?.impactClass).toBe("no_allocation");
    expect(missing.confirmable).toBe(false);
  });

  it("classifies team, direct person, chargeback, and corrected payouts without rewriting them", async () => {
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
    expect(correctionPreview.correctableIds).toEqual([fallback.id]);
    await confirmCompensationCorrection(db, {
      commissionIds: [fallback.id],
      reason: "Restore known historical terms.",
      confirmationKey: "corr-1",
      previewToken: correctionPreview.previewToken!,
      initiator,
    });

    const teamPayouts = await listPayoutsForCommission(db, teamRow.id);
    expect(teamPayouts.some((row) => row.recipientType === "team_member")).toBe(true);
    const impact = await previewStatementPaidMonthChange(db, statement.id, "2026-08");
    expect(impact.items.find((item) => item.commissionId === teamRow.id)?.impactClass).toBe("equivalent_terms");
    expect(impact.items.find((item) => item.commissionId === personRow.id)?.impactClass).toBe("equivalent_terms");
    expect(impact.items.find((item) => item.commissionId === chargeback.id)?.impactClass).toBe("equivalent_terms");
    expect(impact.confirmable).toBe(true);
    await confirmStatementPaidMonthChange(db, {
      statementId: statement.id,
      newPaidMonth: "2026-08",
      reason: "Received in August.",
      confirmationKey: "mixed-1",
      previewToken: impact.previewToken,
      initiator,
    });
    expect(await listPayoutsForCommission(db, teamRow.id)).toEqual(teamPayouts);
    expect((await getCommission(db, chargeback.id))?.grossCommissionCents).toBe(-400);
    expect((await getCommission(db, fallback.id))?.statementMonth).toBe("2026-09");
    const teamReport = await buildTeamReport(db, { kind: "team", paidMonth: "2026-08", teamId: team.id });
    expect(teamReport.rows.some((row) => row.grossCommissionCents === 10000)).toBe(true);
  });

  it("rejects a stale preview and does not partially move the statement", async () => {
    const db = await createTestDb();
    const { group, carrier, dental, statement } = await postedStatement(db, "stale-preview");
    const posted = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 2200,
      importStatementId: statement.id,
      sourceRowKey: "Commissions:1",
    });
    await db.delete(commissionPayouts).where(eq(commissionPayouts.commissionId, posted.id));
    const first = await previewStatementPaidMonthChange(db, statement.id, "2026-08");
    await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 300,
      importStatementId: statement.id,
      sourceRowKey: "Commissions:2",
    });
    await expect(confirmStatementPaidMonthChange(db, {
      statementId: statement.id,
      newPaidMonth: "2026-08",
      reason: "Stale should fail.",
      confirmationKey: "stale-1",
      previewToken: first.previewToken,
      initiator,
    })).rejects.toThrow(/no longer matches/);
    expect((await getImportStatement(db, statement.id))?.paidMonth).toBe("2026-09");
    expect((await getCommission(db, posted.id))?.statementMonth).toBe("2026-09");
  });

  it("protects concurrent confirmation by binding the preview to current state", async () => {
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
    await db.delete(commissionPayouts).where(eq(commissionPayouts.commissionId, posted.id));
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
