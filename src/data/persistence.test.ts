import { describe, expect, it } from "vitest";
import { createAgent, updateAgent } from "./agents";
import { createCarrier, updateCarrier } from "./carriers";
import { createCommission, updateCommission } from "./commissions";
import { createGroup } from "./groups";
import { createLineOfBusiness } from "./linesOfBusiness";
import { createTestDb } from "@/db/test-db";
import { commissionRecords } from "@/db/schema";
import { isForeignKeyError, NotFoundError, ValidationError } from "@/lib/errors";

async function seed() {
  const db = await createTestDb();
  const group = await createGroup(db, { name: "Acme Benefits", groupNumber: "A1" });
  const carrier = await createCarrier(db, { name: "Principal" });
  const lineOfBusiness = await createLineOfBusiness(db, { name: "Dental" });
  const agent = await createAgent(db, { name: "Alex Morgan", defaultCompensationBps: 4000 });
  return { db, group, carrier, lineOfBusiness, agent };
}

describe("relationships and persistence", () => {
  it("creates, reads, and updates reference records by stable IDs", async () => {
    const { db, group, carrier } = await seed();

    expect(group.id).toEqual(expect.any(Number));
    expect(carrier.name).toBe("Principal");
    await expect(createCarrier(db, { name: "principal" })).rejects.toThrow(ValidationError);

    const secondGroup = await createGroup(db, { name: "Beta Co" });
    expect(secondGroup.id).not.toBe(group.id);
    expect((await updateCarrier(db, carrier.id, { name: "Principal Financial" }))?.name).toBe("Principal Financial");
  });

  it("stores commission money as integer cents and keeps agency net consistent", async () => {
    const { db, group, carrier, lineOfBusiness, agent } = await seed();
    const row = await createCommission(db, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: lineOfBusiness.id,
      agentId: agent.id,
      premiumCents: 1000000,
      grossCommissionCents: 50000,
      compensationBps: 4000,
      sourceReference: "principal-2026-08-row-12",
    });

    expect(row.premiumCents).toBe(1000000);
    expect(row.grossCommissionCents).toBe(50000);
    expect(row.agentCompensationCents).toBe(20000);
    expect(row.agencyNetCents).toBe(30000);
    expect(row.groupId).toBe(group.id);
    expect(row.carrierId).toBe(carrier.id);
    expect(row.agentName).toBe("Alex Morgan");
    expect(row.sourceReference).toBe("principal-2026-08-row-12");

    const updated = await updateCommission(db, row.id, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: lineOfBusiness.id,
      agentId: agent.id,
      premiumCents: 1000000,
      grossCommissionCents: 50000,
      compensationBps: 5000,
      sourceReference: "principal-2026-08-row-12",
    });
    expect(updated.id).toBe(row.id);
    expect(updated.agentCompensationCents).toBe(25000);
    expect(updated.agencyNetCents).toBe(25000);
  });

  it("does not pay an assigned agent from the agent-level default when no group agreement exists", async () => {
    const { db, group, carrier, lineOfBusiness, agent } = await seed();
    const row = await createCommission(db, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: lineOfBusiness.id,
      agentId: agent.id,
      grossCommissionCents: 10000,
    });

    expect(row.compensationBps).toBe(0);
    expect(row.agentCompensationCents).toBe(0);
    expect(row.agencyNetCents).toBe(10000);
  });

  it("stores zero agent compensation when an assigned agent has no group agreement", async () => {
    const { db, group, carrier, lineOfBusiness } = await seed();
    const agentWithoutDefault = await createAgent(db, { name: "No Default" });

    const row = await createCommission(db, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: lineOfBusiness.id,
      agentId: agentWithoutDefault.id,
      grossCommissionCents: 10000,
    });
    expect(row.compensationBps).toBe(0);
    expect(row.agentCompensationCents).toBe(0);
  });

  it("accepts an explicit compensation override when the agent has no default", async () => {
    const { db, group, carrier, lineOfBusiness } = await seed();
    const agentWithoutDefault = await createAgent(db, { name: "Explicit Rate" });

    const row = await createCommission(db, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: lineOfBusiness.id,
      agentId: agentWithoutDefault.id,
      grossCommissionCents: 10000,
      compensationBps: 2500,
    });

    expect(row.compensationBps).toBe(2500);
    expect(row.agentCompensationCents).toBe(2500);
    expect(row.agencyNetCents).toBe(7500);
  });

  it("preserves the stored compensation snapshot when an unrelated historical field is edited", async () => {
    const { db, group, carrier, lineOfBusiness, agent } = await seed();
    const original = await createCommission(db, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: lineOfBusiness.id,
      agentId: agent.id,
      grossCommissionCents: 10000,
      compensationBps: 4000,
    });

    await updateAgent(db, agent.id, { name: agent.name, defaultCompensationBps: 6000 });
    const updated = await updateCommission(db, original.id, {
      statementMonth: original.statementMonth,
      groupId: original.groupId,
      carrierId: original.carrierId,
      lineOfBusinessId: original.lineOfBusinessId,
      agentId: original.agentId,
      grossCommissionCents: original.grossCommissionCents,
      notes: "Reviewed without changing compensation",
    });

    expect(updated.compensationBps).toBe(4000);
    expect(updated.agentCompensationCents).toBe(4000);
    expect(updated.agencyNetCents).toBe(6000);
  });

  it("does not copy the previous split when a historical commission is moved to another agent", async () => {
    const { db, group, carrier, lineOfBusiness, agent } = await seed();
    const original = await createCommission(db, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: lineOfBusiness.id,
      agentId: agent.id,
      grossCommissionCents: 10000,
      compensationBps: 4000,
    });
    const replacement = await createAgent(db, { name: "Replacement" });

    const updated = await updateCommission(db, original.id, {
      statementMonth: original.statementMonth,
      groupId: original.groupId,
      carrierId: original.carrierId,
      lineOfBusinessId: original.lineOfBusinessId,
      agentId: replacement.id,
      grossCommissionCents: original.grossCommissionCents,
    });
    expect(updated.agentId).toBe(replacement.id);
    expect(updated.compensationBps).toBe(0);
    expect(updated.agentCompensationCents).toBe(0);
  });

  it("assigns the full gross to agency net when no agent is present", async () => {
    const { db, group, carrier, lineOfBusiness } = await seed();
    const row = await createCommission(db, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: lineOfBusiness.id,
      grossCommissionCents: 12000,
    });

    expect(row.agentId).toBeNull();
    expect(row.agentCompensationCents).toBe(0);
    expect(row.agencyNetCents).toBe(12000);
  });

  it("rejects commission records that point at unknown related IDs", async () => {
    const { db, carrier, lineOfBusiness } = await seed();
    await expect(createCommission(db, {
        statementMonth: "2026-08",
        groupId: 999,
        carrierId: carrier.id,
        lineOfBusinessId: lineOfBusiness.id,
        grossCommissionCents: 100,
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("enforces foreign keys at the database when an ID is fabricated", async () => {
    const db = await createTestDb();
    await expect(
      db.insert(commissionRecords).values({
        statementMonth: "2026-08",
        groupId: 1,
        carrierId: 1,
        lineOfBusinessId: 1,
        premiumCents: null,
        grossCommissionCents: 100,
        compensationBps: 0,
        agentCompensationCents: 0,
        agencyNetCents: 100,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    ).rejects.toSatisfy((error) => isForeignKeyError(error));
  });
});
