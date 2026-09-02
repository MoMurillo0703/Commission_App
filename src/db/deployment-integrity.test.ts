import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { importStatements } from "./schema";
import { createTestDb } from "./test-db";

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
        'import_statements', 'group_compensation_agreements', 'commission_records'
      )
    `);
    const rows = (result as unknown as { rows: Array<{ relname: string; relrowsecurity: boolean }> }).rows;
    expect(rows).toHaveLength(8);
    expect(rows.every((row) => row.relrowsecurity)).toBe(true);
  });
});
