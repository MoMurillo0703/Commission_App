import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { importStatements } from "./schema";
import { createTestDb } from "./test-db";
import { createGroup } from "@/data/groups";
import { createLineOfBusiness } from "@/data/linesOfBusiness";

describe("deployment database integrity", () => {
  it("rejects a paid month outside the calendar", async () => {
    const db = await createTestDb();
    await expect(db.insert(importStatements).values({
      originalFilename: "invalid.xlsx",
      displayName: "Invalid month",
      paidMonth: "2026-13",
      uploadedAt: new Date().toISOString(),
      sourceType: "xlsx",
      status: "uploaded",
      fingerprint: "invalid-month-fingerprint",
      rowCount: 0,
      newGroupCount: 0,
      postedRowCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })).rejects.toThrow();
  });

  it("enables row-level security on every application table", async () => {
    const db = await createTestDb();
    const result = await db.execute(sql`
      SELECT relname, relrowsecurity
      FROM pg_class
      WHERE relname IN (
        'carriers', 'lines_of_business', 'account_managers', 'agents', 'groups',
        'import_statements', 'group_compensation_agreements', 'commission_records',
        'carrier_statement_layouts', 'teams', 'team_memberships', 'compensation_allocations',
        'compensation_allocation_entries', 'commission_payouts'
      )
    `);
    const rows = (result as unknown as { rows: Array<{ relname: string; relrowsecurity: boolean }> }).rows;
    expect(rows).toHaveLength(14);
    expect(rows.every((row) => row.relrowsecurity)).toBe(true);
  });

  it("enforces complete activation and immutable active allocation entries in the database", async () => {
    const db = await createTestDb();
    const group = await createGroup(db, { name: "DB Guard Group" });
    const lob = await createLineOfBusiness(db, { name: "DB Guard LOB" });
    const now = new Date().toISOString();
    const makePlan = async (suffix: string) => {
      const result = await db.execute(sql`
        INSERT INTO compensation_allocations
          (group_id, line_of_business_id, effective_start, status, created_at, updated_at)
        VALUES (${group.id}, ${lob.id}, ${`202${suffix}-01`}, 'inactive', ${now}, ${now})
        RETURNING id
      `);
      return Number((result as unknown as { rows: Array<{ id: number }> }).rows[0]!.id);
    };
    const under = await makePlan("4");
    await db.execute(sql`INSERT INTO compensation_allocation_entries
      (allocation_id, recipient_type, compensation_bps) VALUES (${under}, 'agency', 9999)`);
    await expect(db.execute(sql`UPDATE compensation_allocations SET status = 'active' WHERE id = ${under}`)).rejects.toThrow();

    const over = await makePlan("5");
    await db.execute(sql`INSERT INTO compensation_allocation_entries
      (allocation_id, recipient_type, compensation_bps) VALUES (${over}, 'agency', 6000)`);
    await db.execute(sql`INSERT INTO compensation_allocation_entries
      (allocation_id, recipient_type, person_kind, person_id, compensation_bps)
      VALUES (${over}, 'person', 'agent', 999, 5000)`);
    await expect(db.execute(sql`UPDATE compensation_allocations SET status = 'active' WHERE id = ${over}`)).rejects.toThrow();

    const complete = await makePlan("6");
    await db.execute(sql`INSERT INTO compensation_allocation_entries
      (allocation_id, recipient_type, compensation_bps) VALUES (${complete}, 'agency', 10000)`);
    await expect(db.execute(sql`UPDATE compensation_allocations SET status = 'active' WHERE id = ${complete}`)).resolves.toBeDefined();
    await expect(db.execute(sql`UPDATE compensation_allocation_entries SET compensation_bps = 9999 WHERE allocation_id = ${complete}`)).rejects.toThrow();

    await db.execute(sql`UPDATE compensation_allocations SET status = 'inactive' WHERE id = ${complete}`);
    const five = await makePlan("7");
    for (const personId of [1, 2, 3, 4, 5]) {
      await db.execute(sql`INSERT INTO compensation_allocation_entries
        (allocation_id, recipient_type, person_kind, person_id, compensation_bps)
        VALUES (${five}, 'person', 'agent', ${personId}, 2000)`);
    }
    await expect(db.execute(sql`UPDATE compensation_allocations SET status = 'active' WHERE id = ${five}`)).resolves.toBeDefined();
    await db.execute(sql`UPDATE compensation_allocations SET status = 'inactive' WHERE id = ${five}`);

    const six = await makePlan("8");
    for (const personId of [1, 2, 3, 4, 5, 6]) {
      await db.execute(sql`INSERT INTO compensation_allocation_entries
        (allocation_id, recipient_type, person_kind, person_id, compensation_bps)
        VALUES (${six}, 'person', 'agent', ${personId}, 1000)`);
    }
    await db.execute(sql`INSERT INTO compensation_allocation_entries
      (allocation_id, recipient_type, compensation_bps) VALUES (${six}, 'agency', 4000)`);
    await expect(db.execute(sql`UPDATE compensation_allocations SET status = 'active' WHERE id = ${six}`)).rejects.toThrow();
  });
});
