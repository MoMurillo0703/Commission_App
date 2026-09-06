import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "./test-db";
import { commissionPayouts, commissionRecords, compensationCorrectionItems } from "./schema";
import { createAgent } from "@/data/agents";
import { createCarrier } from "@/data/carriers";
import { createCommission } from "@/data/commissions";
import { createGroup } from "@/data/groups";
import { createLineOfBusiness } from "@/data/linesOfBusiness";

describe("compensation correction migration", () => {
  it("applies 0008 without backfilling or changing existing commissions and payouts", async () => {
    const db = await createTestDb();
    const applied = await db.execute(sql`SELECT filename FROM schema_migrations ORDER BY filename`) as unknown as { rows: Array<{ filename: string }> };
    const filenames = applied.rows.map((row) => row.filename);
    expect(filenames).toContain("0008_compensation_corrections.sql");

    const john = await createAgent(db, { name: "John Elizondo" });
    const group = await createGroup(db, { name: "ABC COMPANY", primaryAgentId: john.id });
    const carrier = await createCarrier(db, { name: "Principal" });
    const medical = await createLineOfBusiness(db, { name: "Medical" });
    const posted = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 2500,
    });
    expect(await db.select().from(compensationCorrectionItems)).toHaveLength(0);
    expect(await db.select().from(commissionRecords)).toHaveLength(1);
    const payouts = await db.select().from(commissionPayouts);
    expect(payouts).toHaveLength(1);
    expect(payouts[0]).toMatchObject({
      commissionId: posted.id,
      allocationId: null,
      recipientType: "agency",
      compensationCents: 2500,
    });
  });
});
