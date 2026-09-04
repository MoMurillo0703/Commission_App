import { describe, expect, it } from "vitest";
import { createCarrier } from "./carriers";
import { createCommission } from "./commissions";
import { createGroup } from "./groups";
import { listGroupLineEvidence } from "./groupLineEvidence";
import { createLineOfBusiness } from "./linesOfBusiness";
import { createTestDb } from "@/db/test-db";

describe("group line evidence", () => {
  it("collects group + LOB pairs from posted commissions without listing unused lines", async () => {
    const db = await createTestDb();
    const group = await createGroup(db, { name: "Acme Benefits" });
    const other = await createGroup(db, { name: "Other Group" });
    const dental = await createLineOfBusiness(db, { name: "Dental" });
    await createLineOfBusiness(db, { name: "Unused Medical" });
    const carrier = await createCarrier(db, { name: "Principal" });
    await createCommission(db, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: dental.id,
      grossCommissionCents: 8000,
    });
    const evidence = await listGroupLineEvidence(db);
    expect(evidence).toContainEqual({ groupId: group.id, lineOfBusinessId: dental.id });
    expect(evidence.some((item) => item.groupId === other.id)).toBe(false);
    expect(evidence.some((item) => item.lineOfBusinessId !== dental.id && item.groupId === group.id)).toBe(false);
  });
});
