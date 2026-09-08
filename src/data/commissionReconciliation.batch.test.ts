import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createAccountManager } from "./accountManagers";
import { createAgent } from "./agents";
import { createAllocation } from "./allocations";
import { createCarrier } from "./carriers";
import {
  normalizePostedAnthemCoverage,
  reassignCommissionsToCanonicalGroup,
  repairImportStatementLinkage,
} from "./commissionIdentityRepair";
import { createCommission, getCommission, listPostedGroupCarrierCoverageMonths } from "./commissions";
import { createGroup } from "./groups";
import { createLineOfBusiness } from "./linesOfBusiness";
import { listPayoutsForCommission } from "./payouts";
import { buildAgencyReport, buildIndividualReport } from "./reports";
import { createImportStatement } from "./statements";
import { createTeam } from "./teams";
import { createTestDb } from "@/db/test-db";
import { commissionPayouts, commissionRecords } from "@/db/schema";
import { fingerprintBuffer } from "@/domain/fingerprint";
import { coverageReceiptsFor, missingCommissionDataReadiness } from "@/domain/coverageMonthReadiness";
import { classifyHistoricalCompensationEvidence } from "@/domain/historicalCompensationEvidence";
import { agencyReportDocument, printableReportHtml } from "@/domain/reportDocuments";

const SEPTEMBER_GROSS = 649973;
const JOHN_SOURCE_GROSS = 214693;
const JOHN_CANONICAL_PAYABLE = 42040;
const HR_GROSS = 46220;

function distribute(count: number, total: number) {
  if (count <= 0) return [];
  const base = Math.trunc(total / count);
  const values = Array.from({ length: count }, () => base);
  values[values.length - 1] += total - base * count;
  return values;
}

describe("September commission reporting and identity reconciliation", () => {
  it("preserves the 96-row $6,499.73 paid-month population while normalizing identity and reports", async () => {
    const db = await createTestDb();
    const john = await createAgent(db, { name: "John Elizando" });
    const mo = await createAgent(db, { name: "Mo Murillo" });
    const laura = await createAccountManager(db, { name: "Laura" });
    const nancy = await createAccountManager(db, { name: "Nancy" });
    const anthem = await createCarrier(db, { name: "Anthem" });
    const choice = await createCarrier(db, { name: "ChoiceBuilder" });
    const calChoice = await createCarrier(db, { name: "CaliforniaChoice" });
    const medical = await createLineOfBusiness(db, { name: "Medical" });
    const dental = await createLineOfBusiness(db, { name: "Dental" });
    const vision = await createLineOfBusiness(db, { name: "Vision" });
    const rawMed = await createLineOfBusiness(db, { name: "MED" });
    const canonicalHr = await createGroup(db, { name: "H & R LABOR CONTRACTING INC" });
    const anthemHr = await createGroup(db, { name: "H & R LABOR CONTRACTING INC" });
    const integrity = await createGroup(db, { name: "Integrity Bookkeeping" });
    const settledBook = await createGroup(db, { name: "John Settled Book" });
    const relyon = await createGroup(db, { name: "RELYON" });
    const ackee = await createGroup(db, { name: "ACKEE HOLDING" });
    const otherGroups = await Promise.all(
      Array.from({ length: 12 }, (_, index) => createGroup(db, { name: `September Group ${index + 1}` })),
    );
    await createAllocation(db, {
      groupId: settledBook.id,
      lineOfBusinessId: dental.id,
      effectiveStart: "2026-09",
      entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }],
    });
    await createAllocation(db, {
      groupId: settledBook.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2026-09",
      entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }],
    });

    const johnSource = [];
    for (const row of [
      { cents: 375, lob: dental.id, group: canonicalHr, carrier: choice, coverage: "2026-07" },
      { cents: 159, lob: dental.id, group: canonicalHr, carrier: choice, coverage: "2026-07" },
      { cents: -89, lob: dental.id, group: canonicalHr, carrier: choice, coverage: "2026-07" },
      { cents: 4659, lob: dental.id, group: canonicalHr, carrier: choice, coverage: "2026-07" },
      { cents: 1398, lob: vision.id, group: canonicalHr, carrier: choice, coverage: "2026-07" },
      { cents: 35196, lob: rawMed.id, group: anthemHr, carrier: anthem, coverage: "2026-07", sourceCoverage: "MED" },
      { cents: 4522, lob: dental.id, group: anthemHr, carrier: anthem, coverage: "2026-07", sourceCoverage: "DENPPO" },
      { cents: 3333, lob: medical.id, group: relyon, carrier: anthem, coverage: "2026-03" },
      { cents: 0, lob: medical.id, group: ackee, carrier: anthem, coverage: "2026-03" },
      { cents: 5653, lob: dental.id, group: settledBook, carrier: choice, coverage: "2026-08" },
      { cents: 36387, lob: medical.id, group: settledBook, carrier: choice, coverage: "2026-06" },
    ]) {
      johnSource.push(await createCommission(db, {
        statementMonth: "2026-09",
        groupId: row.group.id,
        carrierId: row.carrier.id,
        lineOfBusinessId: row.lob,
        grossCommissionCents: row.cents,
        premiumMonth: row.coverage,
        sourceCoverageLabel: "sourceCoverage" in row ? row.sourceCoverage : null,
        sourceGroupLabel: row.group.name,
      }));
    }
    const integrityRow = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: integrity.id,
      carrierId: choice.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 10000,
      premiumMonth: "2026-05",
      sourceGroupLabel: "Integrity Bookkeeping",
    });
    johnSource.push(integrityRow);

    const sourceUsed = johnSource.reduce((sum, row) => sum + row.grossCommissionCents, 0);
    const sourceFill = distribute(42 - johnSource.length, JOHN_SOURCE_GROSS - sourceUsed);
    for (const [index, cents] of sourceFill.entries()) {
      johnSource.push(await createCommission(db, {
        statementMonth: "2026-09",
        groupId: otherGroups[index % 4]!.id,
        carrierId: index % 2 === 0 ? anthem.id : choice.id,
        lineOfBusinessId: dental.id,
        grossCommissionCents: cents,
        premiumMonth: "2026-07",
      }));
    }

    const otherCount = 96 - johnSource.length;
    const otherGross = SEPTEMBER_GROSS - johnSource.reduce((sum, row) => sum + row.grossCommissionCents, 0);
    const others = [];
    for (const [index, cents] of distribute(otherCount, otherGross).entries()) {
      others.push(await createCommission(db, {
        statementMonth: "2026-09",
        groupId: otherGroups[4 + (index % 8)]!.id,
        carrierId: index % 3 === 0 ? anthem.id : index % 3 === 1 ? choice.id : calChoice.id,
        lineOfBusinessId: index % 2 === 0 ? medical.id : vision.id,
        grossCommissionCents: cents,
        premiumMonth: index % 5 === 0 ? null : "2026-08",
      }));
    }
    for (const row of [...johnSource, ...others]) {
      if (row.groupId === settledBook.id) continue;
      if (row.id % 3 === 0) {
        await db.delete(commissionPayouts).where(eq(commissionPayouts.commissionId, row.id));
      }
    }

    const created = [...johnSource, ...others];
    expect(created).toHaveLength(96);
    expect(johnSource).toHaveLength(42);
    expect(johnSource.reduce((sum, row) => sum + row.grossCommissionCents, 0)).toBe(JOHN_SOURCE_GROSS);
    expect(created.reduce((sum, row) => sum + row.grossCommissionCents, 0)).toBe(SEPTEMBER_GROSS);

    const beforePayouts = await db.select().from(commissionPayouts);
    const beforePayoutCents = beforePayouts.reduce((sum, row) => sum + row.compensationCents, 0);
    const johnBefore = (await buildIndividualReport(db, {
      kind: "individual",
      paidMonth: "2026-09",
      personKind: "agent",
      personId: john.id,
    })).totals.compensationCents;

    await reassignCommissionsToCanonicalGroup(db, { sourceGroupId: anthemHr.id, canonicalGroupId: canonicalHr.id });
    await normalizePostedAnthemCoverage(db, anthem.id);
    const anthemStatement = await createImportStatement(db, {
      originalFilename: "anthem-statement-3.csv",
      paidMonth: "2026-09",
      carrierId: anthem.id,
      sourceType: "csv",
      status: "posted",
      fingerprint: fingerprintBuffer(new TextEncoder().encode("anthem-statement-3")),
      preview: { sheets: [], unmatchedGroups: [], rowCount: 2, newGroupCount: 0 },
    });
    const relyonPosted = johnSource.find((row) => row.groupId === relyon.id)!;
    const ackeePosted = johnSource.find((row) => row.groupId === ackee.id)!;
    await repairImportStatementLinkage(db, {
      commissionId: relyonPosted.id,
      importStatementId: anthemStatement.id,
      sourceRowKey: "Commissions:43",
    });
    await repairImportStatementLinkage(db, {
      commissionId: ackeePosted.id,
      importStatementId: anthemStatement.id,
      sourceRowKey: "Commissions:49",
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
      groupId: canonicalHr.id,
      lineOfBusinessId: dental.id,
      effectiveStart: "2026-09",
      entries: [{ recipientType: "team", teamId: team.id, compensationBps: 10000 }],
    });
    await createAllocation(db, {
      groupId: canonicalHr.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2026-09",
      entries: [{ recipientType: "team", teamId: team.id, compensationBps: 10000 }],
    });

    const after = await db.select().from(commissionRecords);
    expect(after).toHaveLength(96);
    expect(new Set(after.map((row) => row.id)).size).toBe(96);
    expect(after.reduce((sum, row) => sum + row.grossCommissionCents, 0)).toBe(SEPTEMBER_GROSS);
    expect(after.every((row) => row.statementMonth === "2026-09")).toBe(true);
    expect(after.filter((row) => row.groupId === canonicalHr.id).reduce((sum, row) => sum + row.grossCommissionCents, 0)).toBe(HR_GROSS);
    expect(after.filter((row) => row.groupId === anthemHr.id)).toHaveLength(0);
    const anthemMedical = after.find((row) => row.grossCommissionCents === 35196);
    expect(anthemMedical?.lineOfBusinessId).toBe(medical.id);
    expect(anthemMedical?.sourceCoverageLabel).toBe("MED");
    expect(anthemMedical?.premiumMonth).toBe("2026-07");
    expect(anthemMedical?.carrierId).toBe(anthem.id);
    expect((await getCommission(db, relyonPosted.id))?.importStatementId).toBe(anthemStatement.id);
    expect((await getCommission(db, relyonPosted.id))?.grossCommissionCents).toBe(3333);
    expect((await getCommission(db, ackeePosted.id))?.sourceRowKey).toBe("Commissions:49");
    expect((await getCommission(db, ackeePosted.id))?.grossCommissionCents).toBe(0);
    expect((await db.select().from(commissionPayouts)).reduce((sum, row) => sum + row.compensationCents, 0)).toBe(beforePayoutCents);
    const hrChargeback = after.find((row) => row.grossCommissionCents === -89);
    expect(hrChargeback?.grossCommissionCents).toBe(-89);

    const agency = await buildAgencyReport(db, { kind: "agency", paidMonth: "2026-09" });
    expect(agency.rows).toHaveLength(96);
    expect(agency.totals.grossCommissionCents).toBe(SEPTEMBER_GROSS);
    expect(agency.rows.every((row) => row.paidMonth === "2026-09")).toBe(true);
    expect(agency.rows.some((row) => row.coverageMonth === "2026-07")).toBe(true);
    expect(agency.executive?.topClients.combinedPercent).toBe("—");
    expect(agency.executive?.carrierBreakdown.totalPercent).toBe("—");
    const html = printableReportHtml(agencyReportDocument(agency.rows, agency.totals, agency.filters, agency.names));
    expect(html).toMatch(/Coverage Month/);
    expect(html).toMatch(/Jul 2026/);
    expect(html).toMatch(/Sep 2026/);
    expect(html).not.toMatch(/premium_month|statement_month/);

    const receipts = await listPostedGroupCarrierCoverageMonths(db);
    expect(coverageReceiptsFor(receipts, canonicalHr.id, anthem.id, medical.id)).toEqual([
      { coverageMonth: "2026-07", paidMonth: "2026-09", grossCommissionCents: 35196 },
    ]);
    const readiness = missingCommissionDataReadiness(receipts);
    expect(readiness.canAnswerPaidMonthReceipt).toBe(true);
    expect(readiness.missingCoverageMonthCount).toBeGreaterThan(0);

    const johnReport = await buildIndividualReport(db, {
      kind: "individual",
      paidMonth: "2026-09",
      personKind: "agent",
      personId: john.id,
    });
    expect(johnReport.totals.compensationCents).toBe(JOHN_CANONICAL_PAYABLE);
    expect(johnReport.totals.compensationCents).toBe(johnBefore);
    expect(johnReport.rows.every((row) => row.paidMonth === "2026-09")).toBe(true);
    expect(johnReport.rows.some((row) => row.premiumMonth === "2026-06" || row.premiumMonth === "2026-08")).toBe(true);
    expect(johnReport.rows.every((row) => row.recipientMethod === "direct" || row.recipientMethod === "team")).toBe(true);
    expect(johnReport.rows.some((row) => row.recipientType === "team")).toBe(false);
    expect(johnReport.rows.reduce((sum, row) => sum + row.compensationCents, 0)).toBe(JOHN_CANONICAL_PAYABLE);

    const hrPayouts = await listPayoutsForCommission(db, johnSource[0]!.id);
    expect(hrPayouts.every((row) => row.recipientType !== "team_member")).toBe(true);

    expect(classifyHistoricalCompensationEvidence({
      johnShareBps: 7000,
      remainingRecipientsEstablished: true,
      calChoiceTeamCoversPaidMonth: true,
    }).status).toBe("prepare_team_allocation");
    expect(classifyHistoricalCompensationEvidence({
      johnShareBps: 5000,
      remainingRecipientsEstablished: false,
    }).status).toBe("needs_product_owner");
  });
});
