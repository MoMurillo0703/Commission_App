import { describe, expect, it } from "vitest";
import { createCarrier } from "./carriers";
import { listCarrierGroupIdentities, rememberCarrierGroupIdentity } from "./carrierGroupIdentities";
import { createGroup } from "./groups";
import { createTestDb } from "@/db/test-db";
import { carrierGroupIdentities } from "@/db/schema";

describe("carrier group identities", () => {
  it("stores one Group per carrier + external number and rejects a duplicate pair", async () => {
    const db = await createTestDb();
    const california = await createCarrier(db, { name: "CaliforniaChoice" });
    const anthem = await createCarrier(db, { name: "Anthem" });
    const chimay = await createGroup(db, { name: "Chimay Enterprise" });
    const other = await createGroup(db, { name: "Other Shop" });

    await rememberCarrierGroupIdentity(db, {
      carrierId: california.id,
      externalGroupNumber: "83746",
      groupId: chimay.id,
    });
    await rememberCarrierGroupIdentity(db, {
      carrierId: anthem.id,
      externalGroupNumber: "83746",
      groupId: other.id,
    });
    expect(await listCarrierGroupIdentities(db, california.id)).toEqual([
      { carrierId: california.id, externalGroupNumber: "83746", groupId: chimay.id },
    ]);
    expect((await listCarrierGroupIdentities(db, anthem.id))[0]?.groupId).toBe(other.id);

    await expect(rememberCarrierGroupIdentity(db, {
      carrierId: california.id,
      externalGroupNumber: "83746",
      groupId: other.id,
    })).rejects.toThrow(/already linked/);

    const now = new Date().toISOString();
    await expect(db.insert(carrierGroupIdentities).values({
      carrierId: california.id,
      externalGroupNumber: "83746",
      groupId: other.id,
      createdAt: now,
      updatedAt: now,
    })).rejects.toThrow();
  });
});
