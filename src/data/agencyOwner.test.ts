import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createAccountManager } from "./accountManagers";
import { createAgent } from "./agents";
import { createAgencyCompensationOwner, getAgencyOwnerForPaidMonth, listAgencyCompensationOwners } from "./agencyOwner";
import { createTestDb } from "@/db/test-db";
import { agencyCompensationOwners } from "@/db/schema";
import { errorChain } from "@/lib/errors";

describe("durable agency compensation owner", () => {
  it("selects the owner by paid month and identity FK, not display name", async () => {
    const db = await createTestDb();
    const mo = await createAgent(db, { name: "MURILLO, MAURILIO" });
    const other = await createAgent(db, { name: "Other" });
    await createAgencyCompensationOwner(db, {
      agentId: mo.id,
      effectiveStartMonth: "2026-01",
    });
    expect(await getAgencyOwnerForPaidMonth(db, "2026-09")).toEqual({ personKind: "agent", personId: mo.id });
    expect(await getAgencyOwnerForPaidMonth(db, "2025-12")).toBeNull();

    await db.execute(sql`UPDATE agents SET name = 'Mo Murillo' WHERE id = ${mo.id}`);
    expect(await getAgencyOwnerForPaidMonth(db, "2026-09")).toEqual({ personKind: "agent", personId: mo.id });
    expect((await getAgencyOwnerForPaidMonth(db, "2026-09"))?.personId).not.toBe(other.id);
  });

  it("rejects overlapping owner periods and requires exactly one recipient FK", async () => {
    const db = await createTestDb();
    const mo = await createAgent(db, { name: "Mo" });
    const laura = await createAccountManager(db, { name: "Laura" });
    await createAgencyCompensationOwner(db, {
      agentId: mo.id,
      effectiveStartMonth: "2026-01",
      effectiveEndMonth: "2026-06",
    });
    await expect(createAgencyCompensationOwner(db, {
      agentId: mo.id,
      effectiveStartMonth: "2026-06",
    })).rejects.toSatisfy((error) => /overlapping agency compensation owner period/i.test(errorChain(error)));

    await expect(db.insert(agencyCompensationOwners).values({
      agentId: mo.id,
      accountManagerId: laura.id,
      effectiveStartMonth: "2027-01",
      effectiveEndMonth: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })).rejects.toSatisfy((error) => /check constraint|exactly one/i.test(errorChain(error)));

    await expect(db.insert(agencyCompensationOwners).values({
      agentId: null,
      accountManagerId: null,
      effectiveStartMonth: "2027-01",
      effectiveEndMonth: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })).rejects.toSatisfy((error) => /check constraint|exactly one/i.test(errorChain(error)));

    expect(await listAgencyCompensationOwners(db)).toHaveLength(1);
  });
});
