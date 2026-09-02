import { describe, expect, it } from "vitest";
import { createAccountManager } from "./accountManagers";
import { createAgent } from "./agents";
import { createCarrier } from "./carriers";
import { createCommission, getCommission } from "./commissions";
import { createGroup, updateGroup } from "./groups";
import { createLineOfBusiness } from "./linesOfBusiness";
import { createTestDb } from "@/db/test-db";
import { ValidationError } from "@/lib/errors";

async function seed() {
  const db = await createTestDb();
  const manager = await createAccountManager(db, { name: "Jordan Lee" });
  const agent = await createAgent(db, { name: "Alex Morgan", defaultCompensationBps: 2500 });
  const group = await createGroup(db, {
    name: "Acme Benefits",
    groupNumber: "A1",
    accountManagerId: manager.id,
    primaryAgentId: agent.id,
    defaultCompensationBps: 4000,
  });
  const carrier = await createCarrier(db, { name: "Principal" });
  const lineOfBusiness = await createLineOfBusiness(db, { name: "Dental" });
  return { db, manager, agent, group, carrier, lineOfBusiness };
}

describe("group assignments", () => {
  it("stores one account manager, primary agent, and default split on a group", async () => {
    const { manager, agent, group } = await seed();
    expect(group.accountManagerId).toBe(manager.id);
    expect(group.primaryAgentId).toBe(agent.id);
    expect(group.defaultCompensationBps).toBe(4000);
  });

  it("rejects a group default split without a primary agent", async () => {
    const db = await createTestDb();
    await expect(createGroup(db, { name: "No Agent", defaultCompensationBps: 4000 }),
    ).rejects.toThrow(ValidationError);
  });

  it("assigns the primary agent on a future commission without paying the leftover group default", async () => {
    const { db, group, carrier, lineOfBusiness, agent } = await seed();
    const row = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: lineOfBusiness.id,
      grossCommissionCents: 10000,
    });

    expect(row.agentId).toBe(agent.id);
    expect(row.compensationBps).toBe(0);
    expect(row.agentCompensationCents).toBe(0);
    expect(row.agencyNetCents).toBe(10000);
  });

  it("does not recalculate existing commissions when the group assignment changes", async () => {
    const { db, group, carrier, lineOfBusiness, agent } = await seed();
    const existing = await createCommission(db, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: lineOfBusiness.id,
      agentId: agent.id,
      grossCommissionCents: 10000,
      compensationBps: 4000,
    });

    const replacement = await createAgent(db, { name: "Jamie Rivera" });
    await updateGroup(db, group.id, {
      name: group.name,
      groupNumber: group.groupNumber,
      accountManagerId: group.accountManagerId,
      primaryAgentId: replacement.id,
      defaultCompensationBps: 6000,
    });

    const unchanged = await getCommission(db, existing.id);
    expect(unchanged?.agentId).toBe(agent.id);
    expect(unchanged?.compensationBps).toBe(4000);
    expect(unchanged?.agentCompensationCents).toBe(4000);
    expect(unchanged?.agencyNetCents).toBe(6000);

    const future = await createCommission(db, {
      statementMonth: "2026-10",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: lineOfBusiness.id,
      grossCommissionCents: 10000,
    });
    expect(future.agentId).toBe(replacement.id);
    expect(future.compensationBps).toBe(0);
    expect(future.agentCompensationCents).toBe(0);
  });
});
