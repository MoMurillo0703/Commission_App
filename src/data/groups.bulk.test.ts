import { describe, expect, it } from "vitest";
import { createAccountManager } from "./accountManagers";
import { createAgreement } from "./agreements";
import { createAgent } from "./agents";
import { createCarrier } from "./carriers";
import { createCommission, getCommission } from "./commissions";
import { bulkAssignGroups, createGroup, listGroups } from "./groups";
import { createLineOfBusiness } from "./linesOfBusiness";
import { createTestDb } from "@/db/test-db";
import { groupCompensationAgreements } from "@/db/schema";

async function seed() {
  const db = await createTestDb();
  const manager = await createAccountManager(db, { name: "Laura Montoya" });
  const agent = await createAgent(db, { name: "John Elizando" });
  const other = await createAgent(db, { name: "Nancy" });
  const groupA = await createGroup(db, { name: "Group A", accountManagerId: manager.id, primaryAgentId: agent.id });
  const groupB = await createGroup(db, { name: "Group B", primaryAgentId: agent.id });
  const carrier = await createCarrier(db, { name: "Choice Builder" });
  const line = await createLineOfBusiness(db, { name: "Group Medical" });
  return { db, manager, agent, other, groupA, groupB, carrier, line };
}

describe("bulk group assignment", () => {
  it("assigns account manager and primary agent independently without touching compensation or posted commissions", async () => {
    const { db, manager, agent, other, groupA, groupB, carrier, line } = await seed();
    await createAgreement(db, {
      groupId: groupA.id,
      agentId: agent.id,
      lineOfBusinessId: line.id,
      compensationBps: 4000,
      effectiveStart: "2026-01",
    });
    const posted = await createCommission(db, {
      statementMonth: "2026-08",
      groupId: groupA.id,
      carrierId: carrier.id,
      lineOfBusinessId: line.id,
      agentId: agent.id,
      grossCommissionCents: 10000,
    });
    const agreementsBefore = await db.select().from(groupCompensationAgreements);

    await bulkAssignGroups(db, {
      groupIds: [groupA.id, groupB.id],
      accountManagerId: manager.id,
    });
    const afterManager = await listGroups(db);
    expect(afterManager.every((group) => group.accountManagerId === manager.id)).toBe(true);
    expect(afterManager.find((group) => group.id === groupA.id)?.primaryAgentId).toBe(agent.id);

    await bulkAssignGroups(db, {
      groupIds: [groupB.id],
      primaryAgentId: other.id,
    });
    const afterAgent = await listGroups(db);
    expect(afterAgent.find((group) => group.id === groupB.id)?.primaryAgentId).toBe(other.id);
    expect(afterAgent.find((group) => group.id === groupA.id)?.primaryAgentId).toBe(agent.id);

    const unchanged = await getCommission(db, posted.id);
    expect(unchanged?.agentCompensationCents).toBe(4000);
    expect(unchanged?.agencyNetCents).toBe(6000);
    expect(await db.select().from(groupCompensationAgreements)).toEqual(agreementsBefore);
  });
});
