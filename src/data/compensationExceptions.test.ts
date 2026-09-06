import { describe, expect, it } from "vitest";
import { createAgent } from "./agents";
import { createCarrier } from "./carriers";
import { createCommission } from "./commissions";
import { listPostedCompensationExceptions } from "./compensationExceptions";
import { createGroup } from "./groups";
import { createLineOfBusiness } from "./linesOfBusiness";
import { buildIndividualReport } from "./reports";
import { createTestDb } from "@/db/test-db";

describe("safe fallback exception listing", () => {
  it("lists genuine Agency fallbacks and excludes legitimate null-allocation settlements", async () => {
    const db = await createTestDb();
    const john = await createAgent(db, { name: "John Elizondo" });
    const group = await createGroup(db, { name: "ABC COMPANY", primaryAgentId: john.id });
    const carrier = await createCarrier(db, { name: "Principal" });
    const medical = await createLineOfBusiness(db, { name: "Medical" });
    const fallback = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 8000,
    });
    const legitimate = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 5000,
      compensationBps: 7000,
    });
    const exceptions = await listPostedCompensationExceptions(db, { paidMonth: "2026-09" });
    expect(exceptions.map((row) => row.commissionId)).toEqual([fallback.id]);
    const report = await buildIndividualReport(db, {
      kind: "recipient",
      paidMonth: "2026-09",
      personKind: "agent",
      personId: john.id,
    });
    expect(report.payable?.unallocated).toHaveLength(0);
    expect(report.payable?.unallocated.map((row) => row.commissionId)).not.toContain(legitimate.id);
    expect(report.payable?.reviewHref).toBeNull();
  });
});
