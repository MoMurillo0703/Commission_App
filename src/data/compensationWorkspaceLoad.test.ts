import { describe, expect, it } from "vitest";
import { createAccountManager } from "./accountManagers";
import { createAgent } from "./agents";
import { createAllocation } from "./allocations";
import { loadCompensationWorkspaceData } from "./compensationWorkspaceLoad";
import { createGroup } from "./groups";
import { createLineOfBusiness } from "./linesOfBusiness";
import { createTestDb } from "@/db/test-db";

describe("compensation workspace load", () => {
  it("loads groups, allocations, directory, and queue without a parallel request burst", async () => {
    const db = await createTestDb();
    const john = await createAgent(db, { name: "John Elizando" });
    const laura = await createAccountManager(db, { name: "Laura Montoya" });
    const group = await createGroup(db, { name: "H R LABOR CONTRACTING", primaryAgentId: john.id, accountManagerId: laura.id });
    const medical = await createLineOfBusiness(db, { name: "Group Medical" });
    const allocation = await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2026-08",
      entries: [
        { recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 7000 },
        { recipientType: "agency", compensationBps: 3000 },
      ],
    });

    const first = await loadCompensationWorkspaceData(db, { ownerMonth: "2026-08" });
    const second = await loadCompensationWorkspaceData(db, { ownerMonth: "2026-08" });

    expect(first.groups.map((row) => row.name)).toEqual(["H R LABOR CONTRACTING"]);
    expect(first.allocations.find((row) => row.id === allocation.id)?.entries.map((entry) => entry.compensationBps)).toEqual([7000, 3000]);
    expect(first.directory.some((row) => row.groupId === group.id)).toBe(true);
    expect(first.linesOfBusiness.map((row) => row.name)).toEqual(["Group Medical"]);
    expect(second.allocations).toEqual(first.allocations);
    expect(second.directory).toEqual(first.directory);
  });
});
