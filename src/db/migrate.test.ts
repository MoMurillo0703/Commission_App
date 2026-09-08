import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb } from "./test-db";
import {
  commissionPayouts,
  commissionRecords,
  compensationCorrectionBatches,
  compensationCorrectionItems,
  agencyCompensationOwners,
  statementPaidMonthChanges,
} from "./schema";
import { createAgent } from "@/data/agents";
import { createAllocation } from "@/data/allocations";
import { createCarrier } from "@/data/carriers";
import { createCommission } from "@/data/commissions";
import { createGroup } from "@/data/groups";
import { createLineOfBusiness } from "@/data/linesOfBusiness";
import { createImportStatement } from "@/data/statements";
import { fingerprintBuffer } from "@/domain/fingerprint";
import { errorChain } from "@/lib/errors";

async function expectImmutableAudit(operation: Promise<unknown>) {
  await operation.then(
    () => {
      throw new Error("expected the database to reject the audit mutation");
    },
    (error: unknown) => {
      expect(errorChain(error)).toMatch(/immutable/i);
    },
  );
}

describe("compensation correction migration", () => {
  it("applies 0008 without backfilling or changing existing commissions and payouts", async () => {
    const db = await createTestDb();
    const applied = await db.execute(sql`SELECT filename FROM schema_migrations ORDER BY filename`) as unknown as { rows: Array<{ filename: string }> };
    const filenames = applied.rows.map((row) => row.filename);
    expect(filenames).toContain("0008_compensation_corrections.sql");
    expect(filenames).toContain("0009_agency_compensation_owners.sql");
    expect(filenames).toContain("0010_commission_source_identity.sql");
    expect(filenames).toContain("0011_source_labels_and_paid_month_changes.sql");

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
    expect(posted.grossCommissionCents).toBe(2500);
    expect(posted.sourceCoverageLabel).toBeNull();
    expect(posted.sourceGroupLabel).toBeNull();
    expect(posted.sourceLobLabel).toBeNull();
    expect(posted.sourcePeriodLabel).toBeNull();
  });

  it("rejects UPDATE and DELETE on compensation correction audit rows", async () => {
    const db = await createTestDb();
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
    const allocation = await createAllocation(db, {
      groupId: group.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2026-09",
      entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }],
    });
    const now = new Date().toISOString();
    const [batch] = await db.insert(compensationCorrectionBatches).values({
      confirmationKey: "audit-immutability-1",
      previewToken: "a".repeat(64),
      requestFingerprint: "b".repeat(64),
      reason: "Seed an audit row for trigger coverage",
      initiatorId: "user-1",
      initiatorEmail: "mo@example.com",
      initiatorName: "Mo Murillo",
      createdAt: now,
    }).returning();
    await db.insert(compensationCorrectionItems).values({
      batchId: batch.id,
      commissionId: posted.id,
      paidMonth: "2026-09",
      allocationId: allocation.id,
      originalPayoutsJson: "[]",
      originalAgentCompensationCents: 0,
      originalAgencyNetCents: 2500,
      originalGrossCommissionCents: 2500,
      correctedPayoutsJson: "[]",
      correctedAgentCompensationCents: 2500,
      correctedAgencyNetCents: 0,
      createdAt: now,
    });
    await expectImmutableAudit(db.execute(sql`UPDATE compensation_correction_batches SET reason = 'tamper'`));
    await expectImmutableAudit(db.execute(sql`UPDATE compensation_correction_items SET paid_month = '2026-08'`));
    await expectImmutableAudit(db.execute(sql`DELETE FROM compensation_correction_items`));
    await expectImmutableAudit(db.execute(sql`DELETE FROM compensation_correction_batches`));
    expect(await db.select().from(compensationCorrectionBatches)).toHaveLength(1);
    expect(await db.select().from(compensationCorrectionItems)).toHaveLength(1);
  });
});

describe("agency compensation owner migration", () => {
  it("applies 0009 without inserting a production owner row", async () => {
    const db = await createTestDb();
    const applied = await db.execute(sql`SELECT filename FROM schema_migrations ORDER BY filename`) as unknown as { rows: Array<{ filename: string }> };
    const filenames = applied.rows.map((row) => row.filename);
    expect(filenames).toContain("0009_agency_compensation_owners.sql");
    expect(await db.select().from(agencyCompensationOwners)).toHaveLength(0);
  });
});

describe("statement paid-month change migration", () => {
  it("rejects UPDATE and DELETE on paid-month change audit rows", async () => {
    const db = await createTestDb();
    const group = await createGroup(db, { name: "ABC COMPANY" });
    const carrier = await createCarrier(db, { name: "Principal" });
    const medical = await createLineOfBusiness(db, { name: "Medical" });
    const statement = await createImportStatement(db, {
      originalFilename: "audit.csv",
      paidMonth: "2026-09",
      sourceType: "csv",
      status: "posted",
      fingerprint: fingerprintBuffer(new TextEncoder().encode("paid-month-audit")),
      preview: { sheets: [], unmatchedGroups: [], rowCount: 0, newGroupCount: 0 },
    });
    await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 100,
      importStatementId: statement.id,
    });
    await db.insert(statementPaidMonthChanges).values({
      statementId: statement.id,
      confirmationKey: "audit-paid-month-1",
      previewToken: "c".repeat(64),
      requestFingerprint: "d".repeat(64),
      oldPaidMonth: "2026-09",
      newPaidMonth: "2026-08",
      commissionIdsJson: "[]",
      commissionCount: 0,
      grossAffectedCents: 0,
      impactClassificationJson: "[]",
      payoutCorrectionRequired: 0,
      payoutCorrectionPerformed: 0,
      reason: "Seed an audit row",
      createdAt: new Date().toISOString(),
    });
    await expectImmutableAudit(db.execute(sql`UPDATE statement_paid_month_changes SET reason = 'tamper'`));
    await expectImmutableAudit(db.execute(sql`DELETE FROM statement_paid_month_changes`));
    expect(await db.select().from(statementPaidMonthChanges)).toHaveLength(1);
  });
});
