import { describe, expect, it } from "vitest";
import { createAccountManager } from "./accountManagers";
import { createAgent } from "./agents";
import { createAllocation, listAllocations } from "./allocations";
import { listCompensationQueue } from "./compensationQueue";
import { createCarrier } from "./carriers";
import { createCommission, getCommission } from "./commissions";
import { createGroup } from "./groups";
import { createLineOfBusiness } from "./linesOfBusiness";
import { listPayoutsForCommission } from "./payouts";
import { createTeam, replaceTeamMembers } from "./teams";
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
});
