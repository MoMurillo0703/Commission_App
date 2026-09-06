import { describe, expect, it } from "vitest";
import { createAccountManager } from "./accountManagers";
import { createAgent } from "./agents";
import { createAllocation, createAllocationsForLines, listAllocations } from "./allocations";
import { listCompensationQueue, listGroupCompensationQueue } from "./compensationQueue";
import { createCarrier } from "./carriers";
import { createCommission, getCommission } from "./commissions";
import { createGroup } from "./groups";
import { createLineOfBusiness } from "./linesOfBusiness";
import { listPayoutsForCommission } from "./payouts";
import { createTeam, listTeams, replaceTeamMembers } from "./teams";
import { classifyRequestedAllocation } from "@/domain/allocationTerms";
import { createTestDb } from "@/db/test-db";
import { ValidationError } from "@/lib/errors";

async function seed() {
  const db = await createTestDb();
  const john = await createAgent(db, { name: "John Elizando" });
  const nancy = await createAgent(db, { name: "Nancy" });
  const laura = await createAccountManager(db, { name: "Laura Montoya" });
  const group = await createGroup(db, { name: "H R LABOR CONTRACTING", primaryAgentId: john.id, accountManagerId: laura.id });
  const carrier = await createCarrier(db, { name: "Choice Builder" });
  const medical = await createLineOfBusiness(db, { name: "Group Medical" });
  return { db, john, nancy, laura, group, carrier, medical };
}

describe("compensation allocations", () => {
  it("saves a complete Agency plus people allocation and snapshots posted results", async () => {
    const { db, john, nancy, laura, group, carrier, medical } = await seed();
    const allocation = await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2026-09",
      entries: [
        { recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 7000 },
        { recipientType: "agency", compensationBps: 2000 },
        { recipientType: "person", personKind: "account_manager", personId: laura.id, compensationBps: 500 },
        { recipientType: "person", personKind: "agent", personId: nancy.id, compensationBps: 500 },
      ],
    });
    expect(allocation.entries).toHaveLength(4);

    const posted = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 10000,
    });
    expect(posted.agentCompensationCents).toBe(8000);
    expect(posted.agencyNetCents).toBe(2000);
    const payouts = await listPayoutsForCommission(db, posted.id);
    expect(payouts.find((row) => row.personName === "John Elizando")?.compensationCents).toBe(7000);
    expect(payouts.find((row) => row.recipientType === "agency")?.compensationCents).toBe(2000);

    await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2027-01",
      entries: [
        { recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 6000 },
        { recipientType: "agency", compensationBps: 2500 },
        { recipientType: "person", personKind: "account_manager", personId: laura.id, compensationBps: 1000 },
        { recipientType: "person", personKind: "agent", personId: nancy.id, compensationBps: 500 },
      ],
    });
    const closed = (await listAllocations(db)).find((row) => row.id === allocation.id);
    expect(closed?.effectiveEnd).toBe("2026-12");
    const later = await createCommission(db, {
      statementMonth: "2027-01",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 10000,
    });
    expect(later.agencyNetCents).toBe(2500);
    expect((await getCommission(db, posted.id))?.agencyNetCents).toBe(2000);
    expect((await listPayoutsForCommission(db, posted.id)).find((row) => row.personName === "John Elizando")?.allocationBps).toBe(7000);
  });

  it("saves Agency plus five people and rejects a sixth person", async () => {
    const { db, john, nancy, laura, group, medical } = await seed();
    const extra = await createAgent(db, { name: "Mo" });
    const fifth = await createAccountManager(db, { name: "Additional AM" });
    const allocation = await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2026-09",
      entries: [
        { recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 2000 },
        { recipientType: "person", personKind: "agent", personId: nancy.id, compensationBps: 2000 },
        { recipientType: "person", personKind: "agent", personId: extra.id, compensationBps: 2000 },
        { recipientType: "person", personKind: "account_manager", personId: laura.id, compensationBps: 1500 },
        { recipientType: "person", personKind: "account_manager", personId: fifth.id, compensationBps: 1500 },
        { recipientType: "agency", compensationBps: 1000 },
      ],
    });
    expect(allocation.entries.filter((entry) => entry.recipientType === "person")).toHaveLength(5);
    const sixth = await createAgent(db, { name: "Sixth Person" });
    await expect(createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2027-01",
      entries: [
        { recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 2000 },
        { recipientType: "person", personKind: "agent", personId: nancy.id, compensationBps: 2000 },
        { recipientType: "person", personKind: "agent", personId: extra.id, compensationBps: 2000 },
        { recipientType: "person", personKind: "account_manager", personId: laura.id, compensationBps: 1500 },
        { recipientType: "person", personKind: "account_manager", personId: fifth.id, compensationBps: 1500 },
        { recipientType: "person", personKind: "agent", personId: sixth.id, compensationBps: 1000 },
      ],
    })).rejects.toThrow(/at most 5 individual people/);
  });

  it("blocks incomplete allocations and distributes a team without rewriting later team membership", async () => {
    const { db, john, nancy, laura, group, carrier, medical } = await seed();
    await expect(createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2026-09",
      entries: [
        { recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 7000 },
        { recipientType: "agency", compensationBps: 2000 },
      ],
    })).rejects.toThrow(ValidationError);

    const team = await createTeam(db, {
      name: "Central Valley Team",
      members: [
        { personKind: "account_manager", personId: laura.id, shareBps: 5000, effectiveStart: "2026-01" },
        { personKind: "agent", personId: nancy.id, shareBps: 5000, effectiveStart: "2026-01" },
      ],
    });
    const listed = await listTeams(db);
    expect(listed.some((row) => row.id === team.id && row.status === "active")).toBe(true);
    await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2026-09",
      entries: [
        { recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 8000 },
        { recipientType: "team", teamId: team.id, compensationBps: 2000 },
      ],
    });
    const posted = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 10000,
    });
    const payouts = await listPayoutsForCommission(db, posted.id);
    expect(payouts.find((row) => row.recipientType === "team")?.compensationCents).toBe(2000);
    expect(payouts.find((row) => row.personName === "Laura Montoya")?.compensationCents).toBe(1000);
    expect(payouts.find((row) => row.personName === "Nancy")?.compensationCents).toBe(1000);

    await replaceTeamMembers(db, team.id, [
      { personKind: "account_manager", personId: laura.id, shareBps: 2500, effectiveStart: "2027-01" },
      { personKind: "agent", personId: nancy.id, shareBps: 7500, effectiveStart: "2027-01" },
    ]);
    const historical = await listPayoutsForCommission(db, posted.id);
    expect(historical.find((row) => row.personName === "Laura Montoya")?.compensationCents).toBe(1000);
    expect(historical.find((row) => row.personName === "Nancy")?.compensationCents).toBe(1000);
  });

  it("removes a saved complete allocation from the compensation work queue", async () => {
    const { db, john, group, carrier, medical } = await seed();
    await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 10000,
    });
    const before = await listCompensationQueue(db);
    expect(before.some((item) => item.groupId === group.id && item.lineOfBusinessId === medical.id)).toBe(true);
    await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2026-09",
      entries: [
        { recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 7000 },
        { recipientType: "agency", compensationBps: 3000 },
      ],
    });
    const after = await listCompensationQueue(db);
    expect(after.some((item) => item.groupId === group.id && item.lineOfBusinessId === medical.id)).toBe(false);
  });

  it("applies one group compensation setup across selected LOBs without rewriting posted snapshots", async () => {
    const { db, john, group, carrier, medical } = await seed();
    const dental = await createLineOfBusiness(db, { name: "Dental" });
    const vision = await createLineOfBusiness(db, { name: "Vision" });
    const chiro = await createLineOfBusiness(db, { name: "Chiro" });
    await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2026-08",
      entries: [
        { recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 4000 },
        { recipientType: "agency", compensationBps: 6000 },
      ],
    });
    const posted = await createCommission(db, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 10000,
    });
    const historicalPayouts = await listPayoutsForCommission(db, posted.id);

    const applied = await createAllocationsForLines(db, {
      groupId: group.id,
      effectiveStart: "2026-09",
      targets: [
        { lineOfBusinessId: dental.id, entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }] },
        { lineOfBusinessId: vision.id, entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }] },
      ],
    });
    expect(applied.createdCount).toBe(2);
    const agencyOnly = await createAllocationsForLines(db, {
      groupId: group.id,
      effectiveStart: "2026-09",
      targets: [{ lineOfBusinessId: chiro.id, entries: [{ recipientType: "agency", compensationBps: 10000 }] }],
    });
    expect(agencyOnly.createdCount).toBe(1);

    const listed = await listAllocations(db);
    expect(listed.filter((row) => row.groupId === group.id && row.status === "active")).toHaveLength(4);
    expect(listed.find((row) => row.lineOfBusinessId === dental.id)?.entries[0]?.compensationBps).toBe(10000);
    expect(listed.find((row) => row.lineOfBusinessId === chiro.id)?.entries).toEqual([
      expect.objectContaining({ recipientType: "agency", compensationBps: 10000 }),
    ]);
    expect(await listPayoutsForCommission(db, posted.id)).toEqual(historicalPayouts);
    expect((await getCommission(db, posted.id))?.agentCompensationCents).toBe(4000);

    const beforeConflict = listed.filter((row) => row.lineOfBusinessId === dental.id);
    await expect(createAllocationsForLines(db, {
      groupId: group.id,
      effectiveStart: "2026-09",
      targets: [
        { lineOfBusinessId: dental.id, entries: [{ recipientType: "agency", compensationBps: 10000 }] },
      ],
    })).rejects.toThrow(/different compensation allocation already exists/);
    expect((await listAllocations(db)).filter((row) => row.lineOfBusinessId === dental.id)).toEqual(beforeConflict);

    const queue = await listCompensationQueue(db);
    expect(queue.some((item) => item.groupId === group.id && [medical.id, dental.id, vision.id, chiro.id].includes(item.lineOfBusinessId))).toBe(false);
  });

  it("creates every selected LOB in one transaction and rolls back all rows when one target conflicts", async () => {
    const { db, john, group, medical } = await seed();
    const dental = await createLineOfBusiness(db, { name: "Dental" });
    const vision = await createLineOfBusiness(db, { name: "Vision" });
    await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2026-09",
      entries: [{ recipientType: "agency", compensationBps: 10000 }],
    });
    const before = await listAllocations(db);
    await expect(createAllocationsForLines(db, {
      groupId: group.id,
      effectiveStart: "2026-09",
      targets: [
        { lineOfBusinessId: dental.id, entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }] },
        { lineOfBusinessId: vision.id, entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }] },
        { lineOfBusinessId: medical.id, entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }] },
      ],
    })).rejects.toThrow(/different compensation allocation already exists/);
    const after = await listAllocations(db);
    expect(after).toEqual(before);
    expect(after.filter((row) => [dental.id, vision.id].includes(row.lineOfBusinessId))).toHaveLength(0);
  });

  it("treats an exact retry of a committed bulk apply as success without creating duplicates", async () => {
    const { db, john, group } = await seed();
    const dental = await createLineOfBusiness(db, { name: "Dental" });
    const vision = await createLineOfBusiness(db, { name: "Vision" });
    const first = await createAllocationsForLines(db, {
      groupId: group.id,
      effectiveStart: "2026-09",
      targets: [
        { lineOfBusinessId: dental.id, entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }] },
        { lineOfBusinessId: vision.id, entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }] },
      ],
    });
    expect(first.createdCount).toBe(2);
    const retry = await createAllocationsForLines(db, {
      groupId: group.id,
      effectiveStart: "2026-09",
      targets: [
        { lineOfBusinessId: dental.id, entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }] },
        { lineOfBusinessId: vision.id, entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }] },
      ],
    });
    expect(retry.createdCount).toBe(0);
    expect(retry.reusedCount).toBe(2);
    expect(retry.allocations.map((row) => row.id).sort()).toEqual(first.allocations.map((row) => row.id).sort());
    expect((await listAllocations(db)).filter((row) => [dental.id, vision.id].includes(row.lineOfBusinessId) && row.status === "active")).toHaveLength(2);
  });

  it("treats a persisted allocation as covered after an ambiguous client timeout without requiring a duplicate POST", async () => {
    const { db, john, group, carrier, medical } = await seed();
    const dental = await createLineOfBusiness(db, { name: "Dental" });
    await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 10000,
    });
    await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 2000,
    });
    expect(await listCompensationQueue(db)).toEqual(expect.arrayContaining([
      expect.objectContaining({ groupId: group.id, lineOfBusinessId: medical.id }),
      expect.objectContaining({ groupId: group.id, lineOfBusinessId: dental.id }),
    ]));

    await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2026-09",
      entries: [
        { recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 },
      ],
    });
    const afterTimeoutReload = await listCompensationQueue(db);
    expect(afterTimeoutReload.some((item) => item.groupId === group.id && item.lineOfBusinessId === medical.id)).toBe(false);
    expect(afterTimeoutReload.some((item) => item.lineOfBusinessId === dental.id)).toBe(true);

    const requested = {
      groupId: group.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2026-09",
      effectiveEnd: null,
      status: "active" as const,
      entries: [{ recipientType: "person" as const, personKind: "agent" as const, personId: john.id, compensationBps: 10000 }],
    };
    expect(classifyRequestedAllocation(await listAllocations(db), requested).status).toBe("exact");
    expect(classifyRequestedAllocation(await listAllocations(db), {
      ...requested,
      entries: [{ recipientType: "agency", compensationBps: 10000 }],
    }).status).toBe("conflict");

    await expect(createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2026-09",
      entries: [
        { recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 },
      ],
    })).rejects.toThrow(/already exists for this group, line, and period/);
    expect((await listAllocations(db)).filter((row) => row.lineOfBusinessId === medical.id && row.status === "active")).toHaveLength(1);
    expect((await listCompensationQueue(db)).some((item) => item.lineOfBusinessId === dental.id)).toBe(true);
  });

  it("applies one Group split to Medical, Dental, and Vision without overwriting Life Agency 100%", async () => {
    const db = await createTestDb();
    const john = await createAgent(db, { name: "John Elizondo" });
    const maurilio = await createAgent(db, { name: "Maurilio Murillo" });
    const laura = await createAccountManager(db, { name: "Laura Montoya" });
    const group = await createGroup(db, { name: "ABC COMPANY", primaryAgentId: john.id, accountManagerId: laura.id });
    const nextGroup = await createGroup(db, { name: "NEXT GROUP" });
    const carrier = await createCarrier(db, { name: "Choice Builder" });
    const medical = await createLineOfBusiness(db, { name: "Medical" });
    const dental = await createLineOfBusiness(db, { name: "Dental" });
    const vision = await createLineOfBusiness(db, { name: "Vision" });
    const life = await createLineOfBusiness(db, { name: "Life" });

    await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: life.id,
      effectiveStart: "2026-01",
      entries: [{ recipientType: "agency", compensationBps: 10000 }],
    });
    const lifePosted = await createCommission(db, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: life.id,
      grossCommissionCents: 5000,
    });
    const lifePayouts = await listPayoutsForCommission(db, lifePosted.id);
    expect(lifePayouts).toEqual([expect.objectContaining({ recipientType: "agency", compensationCents: 5000 })]);

    for (const line of [medical, dental, vision]) {
      await createCommission(db, {
        statementMonth: "2026-08",
        groupId: group.id,
        carrierId: carrier.id,
        lineOfBusinessId: line.id,
        grossCommissionCents: 10000,
      });
    }
    await createCommission(db, {
      statementMonth: "2026-08",
      groupId: nextGroup.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 1000,
    });

    const pairQueue = await listCompensationQueue(db);
    expect(pairQueue.filter((item) => item.groupId === group.id)).toHaveLength(3);
    const groupQueue = await listGroupCompensationQueue(db);
    expect(groupQueue.filter((item) => item.groupId === group.id)).toHaveLength(1);
    expect(groupQueue.find((item) => item.groupId === group.id)?.needingLineCount).toBe(3);

    const split = [
      { recipientType: "person" as const, personKind: "agent" as const, personId: john.id, compensationBps: 7000 },
      { recipientType: "person" as const, personKind: "agent" as const, personId: maurilio.id, compensationBps: 2000 },
      { recipientType: "person" as const, personKind: "account_manager" as const, personId: laura.id, compensationBps: 1000 },
    ];
    const applied = await createAllocationsForLines(db, {
      groupId: group.id,
      effectiveStart: "2026-08",
      targets: [
        { lineOfBusinessId: medical.id, entries: split },
        { lineOfBusinessId: dental.id, entries: split },
        { lineOfBusinessId: vision.id, entries: split },
      ],
    });
    expect(applied.createdCount).toBe(3);

    const listed = await listAllocations(db);
    expect(listed.find((row) => row.lineOfBusinessId === life.id && row.status === "active")?.entries).toEqual([
      expect.objectContaining({ recipientType: "agency", compensationBps: 10000 }),
    ]);
    expect(await listPayoutsForCommission(db, lifePosted.id)).toEqual(lifePayouts);

    await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: life.id,
      effectiveStart: "2026-10",
      entries: [
        { recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 5000 },
        { recipientType: "agency", compensationBps: 5000 },
      ],
    });
    expect(await listPayoutsForCommission(db, lifePosted.id)).toEqual(lifePayouts);
    expect((await listAllocations(db)).find((row) => row.lineOfBusinessId === life.id && row.effectiveStart === "2026-01")?.effectiveEnd).toBe("2026-09");

    expect((await listGroupCompensationQueue(db)).some((item) => item.groupId === group.id)).toBe(false);
    expect((await listGroupCompensationQueue(db)).some((item) => item.groupId === nextGroup.id)).toBe(true);
  });
});
