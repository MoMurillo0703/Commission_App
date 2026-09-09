import { describe, expect, it } from "vitest";
import { createAccountManager } from "./accountManagers";
import { createAgent } from "./agents";
import { createAllocation, createAllocationsForLines, listAllocations } from "./allocations";
import { createCarrier } from "./carriers";
import { createCommission, updateCommission } from "./commissions";
import { createGroup } from "./groups";
import { createLineOfBusiness } from "./linesOfBusiness";
import { listPayoutsForCommission } from "./payouts";
import { buildAgencyReport, buildIndividualReport, buildTeamReport } from "./reports";
import { createTeam } from "./teams";
import { createTestDb } from "@/db/test-db";
import { commissionPayouts, commissionRecords } from "@/db/schema";
import { currentAllocationsForGroup, historicalAllocationsForGroup } from "@/domain/compensationHome";

async function snapshotRecords(db: Awaited<ReturnType<typeof createTestDb>>) {
  const [payouts, commissions] = await Promise.all([
    db.select().from(commissionPayouts),
    db.select().from(commissionRecords),
  ]);
  return {
    payouts: payouts.map((row) => ({ ...row })).sort((left, right) => left.id - right.id),
    commissions: commissions.map((row) => ({ ...row })).sort((left, right) => left.id - right.id),
  };
}

async function seedJoses() {
  const db = await createTestDb();
  const john = await createAgent(db, { name: "John Elizondo" });
  const mo = await createAgent(db, { name: "Mo Murillo" });
  const laura = await createAccountManager(db, { name: "Laura Montoya" });
  const nancy = await createAccountManager(db, { name: "Nancy" });
  const group = await createGroup(db, { name: "JOSES ORNAMENTAL SUPPLY INC" });
  const carrier = await createCarrier(db, { name: "CaliforniaChoice" });
  const dental = await createLineOfBusiness(db, { name: "Dental" });
  const medical = await createLineOfBusiness(db, { name: "Medical" });
  const vision = await createLineOfBusiness(db, { name: "Vision" });
  await createLineOfBusiness(db, { name: "Unused System LOB" });
  const team = await createTeam(db, {
    name: "Cal Choice Team",
    members: [
      { personKind: "agent", personId: john.id, shareBps: 7000, effectiveStart: "2026-08" },
      { personKind: "agent", personId: mo.id, shareBps: 2000, effectiveStart: "2026-08" },
      { personKind: "account_manager", personId: laura.id, shareBps: 500, effectiveStart: "2026-08" },
      { personKind: "account_manager", personId: nancy.id, shareBps: 500, effectiveStart: "2026-08" },
    ],
  });
  const posted = [];
  for (const [index, cents] of [-2519, -2519, -2519, -2519].entries()) {
    posted.push(await createCommission(db, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: cents,
      premiumMonth: "2026-07",
      sourcePeriodLabel: "07-26",
      sourceRowKey: `joses-dental-${index}`,
    }));
  }
  posted.push(await createCommission(db, {
    statementMonth: "2026-08",
    groupId: group.id,
    carrierId: carrier.id,
    lineOfBusinessId: medical.id,
    grossCommissionCents: 62076,
    premiumMonth: "2026-07",
    sourcePeriodLabel: "07-26",
    sourceRowKey: "joses-medical",
  }));
  posted.push(await createCommission(db, {
    statementMonth: "2026-08",
    groupId: group.id,
    carrierId: carrier.id,
    lineOfBusinessId: vision.id,
    grossCommissionCents: 936,
    premiumMonth: "2026-07",
    sourcePeriodLabel: "07-26",
    sourceRowKey: "joses-vision",
  }));
  return { db, john, mo, laura, nancy, group, carrier, dental, medical, vision, team, posted };
}

describe("current unpaid earnings reports", () => {
  it("includes all six Joses rows for John after August Team config even when payout snapshots are Agency-only", async () => {
    const { db, john, group, dental, medical, vision, team, posted } = await seedJoses();
    for (const row of posted) {
      const payouts = await listPayoutsForCommission(db, row.id);
      expect(payouts.every((payout) => payout.recipientType === "agency" || payout.personId !== john.id)).toBe(true);
    }
    const before = await snapshotRecords(db);
    await createAllocationsForLines(db, {
      groupId: group.id,
      effectiveStart: "2026-08",
      targets: [dental.id, medical.id, vision.id].map((lineOfBusinessId) => ({
        lineOfBusinessId,
        entries: [{ recipientType: "team", teamId: team.id, compensationBps: 10000 }],
      })),
    });
    expect(await snapshotRecords(db)).toEqual(before);

    const johnReport = await buildIndividualReport(db, {
      kind: "individual",
      paidMonth: "2026-08",
      personKind: "agent",
      personId: john.id,
    });
    expect(johnReport.rows).toHaveLength(6);
    expect(johnReport.rows.map((row) => row.commissionId).sort()).toEqual(posted.map((row) => row.id).sort());
    expect(johnReport.rows.filter((row) => row.lineOfBusinessName === "Dental").map((row) => row.compensationCents)).toEqual([-1763, -1763, -1763, -1763]);
    expect(johnReport.rows.find((row) => row.lineOfBusinessName === "Medical")?.compensationCents).toBe(43453);
    expect(johnReport.rows.find((row) => row.lineOfBusinessName === "Vision")?.compensationCents).toBe(655);
    expect(johnReport.totals.compensationCents).toBe(37056);
    expect(await snapshotRecords(db)).toEqual(before);

    const teamReport = await buildTeamReport(db, { kind: "team", paidMonth: "2026-08", teamId: team.id });
    expect(teamReport.rows.filter((row) => row.memberName === "John Elizondo").reduce((sum, row) => sum + row.memberCompensationCents, 0)).toBe(37056);
    expect(teamReport.totals.memberCompensationCents).toBe(teamReport.totals.teamCompensationCents);
    expect(teamReport.totals.teamCompensationCents).toBe(-2519 * 4 + 62076 + 936);
    expect(await snapshotRecords(db)).toEqual(before);
  });

  it("does not use a future September allocation for August, and does not write when a report runs", async () => {
    const { db, john, group, dental, medical, vision, team, posted } = await seedJoses();
    await createAllocationsForLines(db, {
      groupId: group.id,
      effectiveStart: "2026-09",
      targets: [dental.id, medical.id, vision.id].map((lineOfBusinessId) => ({
        lineOfBusinessId,
        entries: [{ recipientType: "team", teamId: team.id, compensationBps: 10000 }],
      })),
    });
    const before = await snapshotRecords(db);
    const august = await buildIndividualReport(db, {
      kind: "individual",
      paidMonth: "2026-08",
      personKind: "agent",
      personId: john.id,
    });
    expect(august.rows).toHaveLength(0);
    expect(august.totals.compensationCents).toBe(0);
    const afterSourceChange = await updateCommission(db, posted[4]!.id, { premiumMonth: "2026-09", sourcePeriodLabel: "09-26" });
    expect(afterSourceChange.statementMonth).toBe("2026-08");
    const afterSource = await snapshotRecords(db);
    expect(afterSource.payouts).toEqual(before.payouts);
    const stillAugust = await buildIndividualReport(db, {
      kind: "individual",
      paidMonth: "2026-08",
      personKind: "agent",
      personId: john.id,
    });
    expect(stillAugust.totals.compensationCents).toBe(0);
    await buildAgencyReport(db, { kind: "agency", paidMonth: "2026-08" });
    await buildTeamReport(db, { kind: "team", paidMonth: "2026-08", teamId: team.id });
    expect(await snapshotRecords(db)).toEqual(afterSource);
    expect(afterSource.commissions.find((row) => row.id === posted[4]!.id)?.premiumMonth).toBe("2026-09");
  });

  it("uses August-effective Team terms, keeps identical transactions separate, and leaves unselected LOBs unchanged", async () => {
    const { db, john, group, dental, medical, vision, team, carrier } = await seedJoses();
    const life = await createLineOfBusiness(db, { name: "Life" });
    const lifeAllocation = await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: life.id,
      effectiveStart: "2026-01",
      entries: [{ recipientType: "agency", compensationBps: 10000 }],
    });
    const beforeLife = (await listAllocations(db)).find((row) => row.id === lifeAllocation.id);
    const duplicate = await createCommission(db, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: -2519,
      sourceRowKey: "joses-dental-duplicate-statement",
    });
    const applied = await createAllocationsForLines(db, {
      groupId: group.id,
      effectiveStart: "2026-08",
      targets: [dental.id, medical.id, vision.id].map((lineOfBusinessId) => ({
        lineOfBusinessId,
        entries: [{ recipientType: "team", teamId: team.id, compensationBps: 10000 }],
      })),
    });
    expect(applied.createdCount).toBe(3);
    expect((await listAllocations(db)).find((row) => row.id === lifeAllocation.id)).toEqual(beforeLife);

    const johnReport = await buildIndividualReport(db, {
      kind: "individual",
      paidMonth: "2026-08",
      personKind: "agent",
      personId: john.id,
    });
    expect(johnReport.rows.filter((row) => row.lineOfBusinessName === "Dental")).toHaveLength(5);
    expect(johnReport.rows.some((row) => row.commissionId === duplicate.id)).toBe(true);

    const later = await createAllocationsForLines(db, {
      groupId: group.id,
      effectiveStart: "2026-11",
      targets: [{
        lineOfBusinessId: dental.id,
        entries: [
          { recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 6000 },
          { recipientType: "agency", compensationBps: 4000 },
        ],
      }],
    });
    expect(later.createdCount).toBe(1);
    const dentalHistory = (await listAllocations(db)).filter((row) => row.lineOfBusinessId === dental.id);
    const closed = dentalHistory.find((row) => row.effectiveStart === "2026-08");
    const next = dentalHistory.find((row) => row.effectiveStart === "2026-11");
    expect(closed?.effectiveEnd).toBe("2026-10");
    expect(next?.effectiveEnd).toBeNull();
    expect(currentAllocationsForGroup(dentalHistory, group.id, "2026-09").map((row) => row.effectiveStart)).toEqual(["2026-08"]);
    expect(historicalAllocationsForGroup(dentalHistory, group.id, "2026-09").map((row) => row.effectiveStart)).toEqual(["2026-11"]);
  });

  it("saves selected unconfigured LOBs as explicit Agency 100% and keeps John at $0", async () => {
    const { db, john, group, dental, medical } = await seedJoses();
    const before = await snapshotRecords(db);
    const saved = await createAllocationsForLines(db, {
      groupId: group.id,
      effectiveStart: "2026-08",
      targets: [
        { lineOfBusinessId: dental.id, entries: [{ recipientType: "agency", compensationBps: 10000 }] },
        { lineOfBusinessId: medical.id, entries: [{ recipientType: "agency", compensationBps: 10000 }] },
      ],
    });
    expect(saved.createdCount).toBe(2);
    expect(saved.allocations.every((row) => row.entries[0]?.recipientType === "agency" && row.entries[0]?.compensationBps === 10000)).toBe(true);
    const johnReport = await buildIndividualReport(db, {
      kind: "individual",
      paidMonth: "2026-08",
      personKind: "agent",
      personId: john.id,
    });
    expect(johnReport.totals.compensationCents).toBe(0);
    expect((await snapshotRecords(db)).payouts).toEqual(before.payouts);
  });

  it("surfaces REVIEW REQUIRED for invalid Team membership and does not omit the commission", async () => {
    const db = await createTestDb();
    const john = await createAgent(db, { name: "John Elizondo" });
    const group = await createGroup(db, { name: "Review Group" });
    const carrier = await createCarrier(db, { name: "Principal" });
    const dental = await createLineOfBusiness(db, { name: "Dental" });
    const posted = await createCommission(db, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 8000,
    });
    const team = await createTeam(db, {
      name: "Future Team",
      members: [{ personKind: "agent", personId: john.id, shareBps: 10000, effectiveStart: "2026-09" }],
    });
    await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: dental.id,
      effectiveStart: "2026-08",
      entries: [{ recipientType: "team", teamId: team.id, compensationBps: 10000 }],
    });
    const report = await buildIndividualReport(db, {
      kind: "individual",
      paidMonth: "2026-08",
      personKind: "agent",
      personId: john.id,
    });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.commissionId).toBe(posted.id);
    expect(report.rows[0]?.reviewRequired).toBe(true);
    expect(report.rows[0]?.reviewReason).toBe("Team has invalid effective membership");
    expect(report.rows[0]?.recipientName).toBe("REVIEW REQUIRED");
  });

  it("projects direct Person, Team, and mixed allocations from posted commissions rather than payout snapshots", async () => {
    const db = await createTestDb();
    const john = await createAgent(db, { name: "John Elizondo" });
    const mo = await createAgent(db, { name: "Mo Murillo" });
    const group = await createGroup(db, { name: "Mixed Group" });
    const carrier = await createCarrier(db, { name: "Principal" });
    const dental = await createLineOfBusiness(db, { name: "Dental" });
    const medical = await createLineOfBusiness(db, { name: "Medical" });
    const team = await createTeam(db, {
      name: "Producers",
      members: [
        { personKind: "agent", personId: john.id, shareBps: 7000, effectiveStart: "2026-08" },
        { personKind: "agent", personId: mo.id, shareBps: 3000, effectiveStart: "2026-08" },
      ],
    });
    await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: dental.id,
      effectiveStart: "2026-08",
      entries: [
        { recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 7000 },
        { recipientType: "agency", compensationBps: 3000 },
      ],
    });
    await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2026-08",
      entries: [
        { recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 4000 },
        { recipientType: "team", teamId: team.id, compensationBps: 6000 },
      ],
    });
    const direct = await createCommission(db, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 10000,
    });
    const mixed = await createCommission(db, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 10000,
    });
    const johnReport = await buildIndividualReport(db, {
      kind: "individual",
      paidMonth: "2026-08",
      personKind: "agent",
      personId: john.id,
    });
    expect(johnReport.rows.find((row) => row.commissionId === direct.id)?.compensationCents).toBe(7000);
    expect(johnReport.rows.filter((row) => row.commissionId === mixed.id)).toHaveLength(2);
    expect(johnReport.rows.filter((row) => row.commissionId === mixed.id).reduce((sum, row) => sum + row.compensationCents, 0)).toBe(4000 + 4200);
    expect(johnReport.rows.some((row) => row.recipientType === "team")).toBe(false);
    const teamReport = await buildTeamReport(db, { kind: "team", paidMonth: "2026-08", teamId: team.id });
    expect(teamReport.totals.teamCompensationCents).toBe(6000);
    expect(teamReport.totals.memberCompensationCents).toBe(6000);
  });
});
