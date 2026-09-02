import { describe, expect, it } from "vitest";
import { createAccountManager } from "./accountManagers";
import { createAgreement, listAgreements, listGroupsForAccountManager, listGroupsForAgent, updateAgreement } from "./agreements";
import { createAgent } from "./agents";
import { createCarrier } from "./carriers";
import { createCommission, getCommission } from "./commissions";
import { createGroup, updateGroup } from "./groups";
import { createLineOfBusiness } from "./linesOfBusiness";
import { createTestDb } from "@/db/test-db";
import { groupCompensationAgreements } from "@/db/schema";
import { errorChain, ValidationError } from "@/lib/errors";

async function seed() {
  const db = await createTestDb();
  const manager = await createAccountManager(db, { name: "Jordan Lee" });
  const agent = await createAgent(db, { name: "Alex Morgan", defaultCompensationBps: 2500 });
  const otherAgent = await createAgent(db, { name: "Jamie Rivera" });
  const group = await createGroup(db, {
    name: "Acme Benefits",
    groupNumber: "A1",
    accountManagerId: manager.id,
    primaryAgentId: agent.id,
    defaultCompensationBps: 4000,
  });
  const carrier = await createCarrier(db, { name: "Principal" });
  const medical = await createLineOfBusiness(db, { name: "Medical" });
  const dental = await createLineOfBusiness(db, { name: "Dental" });
  return { db, manager, agent, otherAgent, group, carrier, medical, dental };
}

describe("effective-dated group compensation", () => {
  it("allows a group to have an assigned agent with no compensation agreement", async () => {
    const { db, group, carrier, dental, agent } = await seed();
    const row = await createCommission(db, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      agentId: agent.id,
      grossCommissionCents: 10000,
    });

    expect(row.agentId).toBe(agent.id);
    expect(row.compensationBps).toBe(0);
    expect(row.agentCompensationCents).toBe(0);
    expect(row.agencyNetCents).toBe(10000);
  });

  it("does not use groups.default_compensation_bps or the agent default to pay a future commission", async () => {
    const { db, group, carrier, dental } = await seed();
    const row = await createCommission(db, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 10000,
    });

    expect(row.agentId).toBe(group.primaryAgentId);
    expect(row.compensationBps).toBe(0);
    expect(row.agentCompensationCents).toBe(0);
  });

  it("pays only the line of business covered by an agreement", async () => {
    const { db, group, agent, carrier, medical, dental } = await seed();
    await createAgreement(db, {
      groupId: group.id,
      agentId: agent.id,
      lineOfBusinessId: medical.id,
      compensationBps: 4000,
      effectiveStart: "2026-01",
    });

    const medicalRow = await createCommission(db, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      agentId: agent.id,
      grossCommissionCents: 10000,
    });
    const dentalRow = await createCommission(db, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      agentId: agent.id,
      grossCommissionCents: 10000,
    });

    expect(medicalRow.compensationBps).toBe(4000);
    expect(medicalRow.agentCompensationCents).toBe(4000);
    expect(dentalRow.compensationBps).toBe(0);
    expect(dentalRow.agentCompensationCents).toBe(0);
  });

  it("closes the prior period and keeps the old rate when a new split begins", async () => {
    const { db, group, agent, carrier, medical } = await seed();
    const original = await createAgreement(db, {
      groupId: group.id,
      agentId: agent.id,
      lineOfBusinessId: medical.id,
      compensationBps: 4000,
      effectiveStart: "2025-01",
    });
    const existing = await createCommission(db, {
      statementMonth: "2026-06",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      agentId: agent.id,
      grossCommissionCents: 10000,
    });

    const next = await createAgreement(db, {
      groupId: group.id,
      agentId: agent.id,
      lineOfBusinessId: medical.id,
      compensationBps: 6000,
      effectiveStart: "2026-07",
    });

    const closed = (await listAgreements(db)).find((row) => row.id === original.id);
    expect(closed?.compensationBps).toBe(4000);
    expect(closed?.effectiveEnd).toBe("2026-06");
    expect(next.compensationBps).toBe(6000);
    expect(next.effectiveEnd).toBeNull();

    const unchanged = await getCommission(db, existing.id);
    expect(unchanged?.compensationBps).toBe(4000);
    expect(unchanged?.agentCompensationCents).toBe(4000);

    const future = await createCommission(db, {
      statementMonth: "2026-07",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      agentId: agent.id,
      grossCommissionCents: 10000,
    });
    expect(future.compensationBps).toBe(6000);
    expect(future.agentCompensationCents).toBe(6000);

    const historical = await createCommission(db, {
      statementMonth: "2026-06",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      agentId: agent.id,
      grossCommissionCents: 10000,
    });
    expect(historical.compensationBps).toBe(4000);
  });

  it("does not apply an agreement before its effective start", async () => {
    const { db, group, agent, carrier, medical } = await seed();
    await createAgreement(db, {
      groupId: group.id,
      agentId: agent.id,
      lineOfBusinessId: medical.id,
      compensationBps: 5000,
      effectiveStart: "2026-09",
    });

    const before = await createCommission(db, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      agentId: agent.id,
      grossCommissionCents: 10000,
    });
    expect(before.compensationBps).toBe(0);
  });

  it("rejects a new agreement that would overwrite the same start month", async () => {
    const { db, group, agent, medical } = await seed();
    await createAgreement(db, {
      groupId: group.id,
      agentId: agent.id,
      lineOfBusinessId: medical.id,
      compensationBps: 4000,
      effectiveStart: "2026-01",
    });

    await expect(createAgreement(db, {
        groupId: group.id,
        agentId: agent.id,
        lineOfBusinessId: medical.id,
        compensationBps: 5000,
        effectiveStart: "2026-01",
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("prevents overlapping agreements across agents for the same group and line", async () => {
    const { db, group, agent, otherAgent, medical } = await seed();
    await createAgreement(db, {
      groupId: group.id,
      agentId: agent.id,
      lineOfBusinessId: medical.id,
      compensationBps: 4000,
      effectiveStart: "2026-01",
    });

    await expect(createAgreement(db, {
        groupId: group.id,
        agentId: otherAgent.id,
        lineOfBusinessId: medical.id,
        compensationBps: 3000,
        effectiveStart: "2026-01",
      }),
    ).rejects.toThrow(/group, line, and period/);

    const replacement = await createAgreement(db, {
      groupId: group.id,
      agentId: otherAgent.id,
      lineOfBusinessId: medical.id,
      compensationBps: 3000,
      effectiveStart: "2026-07",
    });
    const agreements = await listAgreements(db);
    const prior = agreements.find((agreement) => agreement.agentId === agent.id);
    expect(prior?.effectiveEnd).toBe("2026-06");
    expect(replacement.effectiveStart).toBe("2026-07");
  });

  it("rejects zero-percent agreements because no agreement represents no compensation", async () => {
    const { db, group, agent, medical } = await seed();
    await expect(createAgreement(db, {
        groupId: group.id,
        agentId: agent.id,
        lineOfBusinessId: medical.id,
        compensationBps: 0,
        effectiveStart: "2026-01",
      }),
    ).rejects.toThrow(/greater than 0/);
  });

  it("enforces cross-agent non-overlap at the database boundary", async () => {
    const { db, group, agent, otherAgent, medical } = await seed();
    await createAgreement(db, {
      groupId: group.id,
      agentId: agent.id,
      lineOfBusinessId: medical.id,
      compensationBps: 4000,
      effectiveStart: "2026-01",
    });
    const now = new Date().toISOString();

    await expect(
      db.insert(groupCompensationAgreements).values({
        groupId: group.id,
        agentId: otherAgent.id,
        lineOfBusinessId: medical.id,
        compensationBps: 3000,
        effectiveStart: "2026-06",
        effectiveEnd: null,
        status: "active",
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toSatisfy((error) => /overlapping active compensation agreement/i.test(errorChain(error)));
  });

  it("lists groups tied to an agent and an account manager", async () => {
    const { db, manager, agent, otherAgent, group } = await seed();
    const extra = await createGroup(db, { name: "Beta Co", primaryAgentId: otherAgent.id });
    await createAgreement(db, {
      groupId: extra.id,
      agentId: agent.id,
      lineOfBusinessId: (await createLineOfBusiness(db, { name: "Vision" })).id,
      compensationBps: 2000,
      effectiveStart: "2026-01",
    });

    expect((await listGroupsForAccountManager(db, manager.id)).map((row) => row.name)).toEqual(["Acme Benefits"]);
    expect((await listGroupsForAgent(db, agent.id)).map((row) => row.name)).toEqual(["Acme Benefits", "Beta Co"]);
  });

  it("does not recalculate stored commissions when a group assignment later changes", async () => {
    const { db, group, agent, otherAgent, carrier, medical } = await seed();
    await createAgreement(db, {
      groupId: group.id,
      agentId: agent.id,
      lineOfBusinessId: medical.id,
      compensationBps: 4000,
      effectiveStart: "2026-01",
    });
    const existing = await createCommission(db, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      agentId: agent.id,
      grossCommissionCents: 10000,
    });

    await updateGroup(db, group.id, {
      name: group.name,
      primaryAgentId: otherAgent.id,
      accountManagerId: group.accountManagerId,
    });
    await updateAgreement(db, (await listAgreements(db))[0]!.id, { status: "inactive" });

    const unchanged = await getCommission(db, existing.id);
    expect(unchanged?.agentId).toBe(agent.id);
    expect(unchanged?.compensationBps).toBe(4000);
    expect(unchanged?.agentCompensationCents).toBe(4000);
  });
});
