import { describe, expect, it } from "vitest";
import { createAccountManager } from "./accountManagers";
import { createAgent } from "./agents";
import { createAllocation, listAllocations } from "./allocations";
import { createCarrier } from "./carriers";
import { createCommission, listGroupCommissions } from "./commissions";
import { createGroup, getGroup, updateGroup } from "./groups";
import { loadGroupDirectory, loadGroupWorkspace } from "./groupWorkspace";
import { createLineOfBusiness } from "./linesOfBusiness";
import { loadPeopleDirectory, loadPersonWorkspace } from "./peopleWorkspace";
import { createTestDb } from "@/db/test-db";
import { rememberCarrierGroupIdentity } from "./carrierGroupIdentities";
import { filterGroupDirectory, emptyGroupDirectoryFilters } from "@/domain/groupDirectory";
import { classifyGroupLobCompensation } from "@/domain/groupCompensationStatus";
import { validateAllocationEntries } from "@/domain/allocations";

async function seed() {
  const db = await createTestDb();
  const john = await createAgent(db, { name: "John Elizondo" });
  const alexAgent = await createAgent(db, { name: "Alex Morgan" });
  const alexManager = await createAccountManager(db, { name: "Alex Morgan" });
  const laura = await createAccountManager(db, { name: "Laura Montoya" });
  const carrier = await createCarrier(db, { name: "Beam" });
  const life = await createLineOfBusiness(db, { name: "Life" });
  const group = await createGroup(db, { name: "Acme Benefits", groupNumber: "A1", primaryAgentId: john.id, accountManagerId: laura.id });
  await rememberCarrierGroupIdentity(db, { carrierId: carrier.id, externalGroupNumber: "CA02483", groupId: group.id });
  return { db, john, alexAgent, alexManager, laura, carrier, life, group };
}

describe("groups and people workspace", () => {
  it("searches name, legacy number, and carrier-scoped number and routes Group Detail by stable id", async () => {
    const { db, group } = await seed();
    const directory = await loadGroupDirectory(db);
    expect(filterGroupDirectory(directory.rows, { ...emptyGroupDirectoryFilters(), query: "acme" }).map((row) => row.id)).toEqual([group.id]);
    expect(filterGroupDirectory(directory.rows, { ...emptyGroupDirectoryFilters(), query: "A1" }).map((row) => row.id)).toEqual([group.id]);
    expect(filterGroupDirectory(directory.rows, { ...emptyGroupDirectoryFilters(), query: "CA02483" }).map((row) => row.id)).toEqual([group.id]);
    const workspace = await loadGroupWorkspace(db, group.id);
    expect(workspace.group.id).toBe(group.id);
    expect(workspace.directoryRow.externalGroupNumbers).toContain("ca02483");
  });

  it("edits Primary Agent and Account Manager by id without creating compensation", async () => {
    const { db, group, alexAgent, alexManager } = await seed();
    await updateGroup(db, group.id, {
      name: group.name,
      groupNumber: group.groupNumber,
      primaryAgentId: alexAgent.id,
      accountManagerId: alexManager.id,
    });
    const after = await getGroup(db, group.id);
    expect(after?.primaryAgentId).toBe(alexAgent.id);
    expect(after?.accountManagerId).toBe(alexManager.id);
    expect(await listAllocations(db)).toHaveLength(0);
  });

  it("saves a 100% split, rejects under/over 100%, versions forward, and still enforces overlap", async () => {
    const { db, group, life, john } = await seed();
    await expect(() => validateAllocationEntries([{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 7000 }], { requireComplete: true })).toThrow(/100/);
    await expect(() => validateAllocationEntries([
      { recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 7000 },
      { recipientType: "agency", compensationBps: 4000 },
    ], { requireComplete: true })).toThrow();

    const first = await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: life.id,
      effectiveStart: "2026-01",
      entries: [
        { recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 7000 },
        { recipientType: "agency", compensationBps: 3000 },
      ],
    });
    expect(first.entries.reduce((sum, entry) => sum + entry.compensationBps, 0)).toBe(10000);

    const second = await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: life.id,
      effectiveStart: "2026-09",
      entries: [{ recipientType: "agency", compensationBps: 10000 }],
    });
    const rows = await listAllocations(db);
    const prior = rows.find((row) => row.id === first.id);
    expect(prior?.effectiveEnd).toBe("2026-08");
    expect(second.effectiveStart).toBe("2026-09");
    expect(second.effectiveEnd).toBeNull();

    await expect(createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: life.id,
      effectiveStart: "2026-08",
      entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }],
    })).rejects.toThrow(/already exists for this group, line, and period/);
    expect((await listAllocations(db)).find((row) => row.id === second.id)?.effectiveStart).toBe("2026-09");
  });

  it("keeps Agent and Account Manager identities distinct and counts assigned Groups", async () => {
    const { db, alexAgent, alexManager, group } = await seed();
    const people = (await loadPeopleDirectory(db)).people;
    const agent = people.find((person) => person.agentId === alexAgent.id);
    const manager = people.find((person) => person.accountManagerId === alexManager.id);
    expect(agent?.key).toBe(`agent:${alexAgent.id}`);
    expect(manager?.key).toBe(`account_manager:${alexManager.id}`);
    expect(agent?.name).toBe(manager?.name);
    expect(agent?.href).toBe(`/people/agent/${alexAgent.id}`);
    expect(manager?.href).toBe(`/people/account-manager/${alexManager.id}`);
    const john = people.find((person) => person.primaryAgentGroupCount === 1);
    expect(john?.href).toBeDefined();
    const person = await loadPersonWorkspace(db, "agent", john!.agentId!);
    expect(person.primaryAgentFor.map((item) => item.id)).toEqual([group.id]);
    expect(person.compensation).toHaveLength(0);
  });

  it("preserves signed commissions and paid-month order without mutating payouts", async () => {
    const { db, group, carrier, life } = await seed();
    await createCommission(db, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: life.id,
      grossCommissionCents: 8000,
    });
    await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: life.id,
      grossCommissionCents: -2000,
    });
    const rows = await listGroupCommissions(db, group.id);
    expect(rows.map((row) => row.grossCommissionCents)).toEqual([-2000, 8000]);
    expect(rows.map((row) => row.statementMonth)).toEqual(["2026-09", "2026-08"]);
    const workspace = await loadGroupWorkspace(db, group.id);
    expect(workspace.commissions.map((row) => row.grossCommissionCents)).toEqual([-2000, 8000]);
    const current = classifyGroupLobCompensation({
      asOfMonth: workspace.asOfMonth,
      allocations: [],
    });
    expect(current.kind).toBe("default_unconfigured");
  });
});
