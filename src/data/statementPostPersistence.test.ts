import { afterEach, describe, expect, it } from "vitest";
import { StatementBlockedError } from "@/lib/errors";
import { toErrorResponse } from "@/lib/http";
import { createTestDb } from "@/db/test-db";
import { fingerprintBuffer } from "@/domain/fingerprint";
import type { ColumnMapping } from "@/domain/columnMapping";
import { previewWorkbook } from "@/domain/workbook";
import {
  acceptedPostHttpBody,
  blockedPostMessage,
  persistedFinancialPostSucceeded,
  postRejectionUserMessage,
  shouldCallOnPosted,
  statementPostBannerKind,
} from "@/domain/statementPostPersistence";
import { createAgent } from "./agents";
import { createCarrier } from "./carriers";
import { listCommissions } from "./commissions";
import { createGroup, listGroups } from "./groups";
import { postImportStatement, previewImportPosting } from "./importPosting";
import { createLineOfBusiness } from "./linesOfBusiness";
import { createImportStatement, getImportStatement } from "./statements";
import { setTransactionFailPoint } from "./transactionTestHook";
import ExcelJS from "exceljs";

const mapping: ColumnMapping = {
  groupName: "Group Name",
  groupNumber: "Group Number",
  carrier: "Carrier",
  lineOfBusiness: "LOB",
  agent: "Agent",
  premium: "Premium",
  grossCommission: "Commission",
  premiumMonth: "Premium Month",
};

afterEach(() => {
  setTransactionFailPoint(null);
});

async function workbook(rows: string[][]) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Commissions");
  sheet.addRow(["Group Name", "Group Number", "Carrier", "LOB", "Agent", "Premium", "Commission", "Split", "Premium Month"]);
  for (const row of rows) sheet.addRow(row);
  return new Uint8Array(await book.xlsx.writeBuffer());
}

async function seed() {
  const db = await createTestDb();
  const group = await createGroup(db, { name: "Acme Benefits", groupNumber: "A1" });
  const carrier = await createCarrier(db, { name: "Principal" });
  const lineOfBusiness = await createLineOfBusiness(db, { name: "Dental" });
  const agent = await createAgent(db, { name: "Alex Morgan", defaultCompensationBps: 4000 });
  return { db, group, carrier, lineOfBusiness, agent };
}

async function savedStatement(
  db: Awaited<ReturnType<typeof createTestDb>>,
  rows: string[][],
  paidMonth = "2026-09",
) {
  const buffer = await workbook(rows);
  return createImportStatement(db, {
    originalFilename: "beam-fixture.xlsx",
    paidMonth,
    carrierId: null,
    sourceType: "excel",
    status: "mapped",
    fingerprint: fingerprintBuffer(buffer),
    preview: await previewWorkbook(buffer, await listGroups(db)),
  });
}

describe("statement post persistence", () => {
  it("1. unresolved Group prevents posting", async () => {
    const { db } = await seed();
    const statement = await savedStatement(db, [
      ["Beam Co", "CA1", "Principal", "Dental", "Alex Morgan", "1000.00", "80.00", "25", "2026-08"],
    ]);
    const preview = await previewImportPosting(db, statement.id, mapping);
    expect(preview.unmatchedGroups.length).toBeGreaterThan(0);
    expect(preview.readiness.canContinue).toBe(false);
    await expect(postImportStatement(db, statement.id, mapping)).rejects.toMatchObject({ name: "StatementBlockedError" });
  });

  it("2. unresolved LOB prevents posting", async () => {
    const { db } = await seed();
    const statement = await savedStatement(db, [
      ["Acme Benefits", "A1", "Principal", "SmartPremium Select", "Alex Morgan", "1000.00", "80.00", "25", "2026-08"],
    ]);
    const preview = await previewImportPosting(db, statement.id, mapping);
    expect(preview.unmatchedLines.length).toBeGreaterThan(0);
    expect(preview.readiness.canContinue).toBe(false);
    await expect(postImportStatement(db, statement.id, mapping)).rejects.toMatchObject({ name: "StatementBlockedError" });
  });

  it("3. rejected posting cannot render or return success", async () => {
    const { db } = await seed();
    const statement = await savedStatement(db, [
      ["Beam Co", "CA1", "Principal", "SmartPremium Select", "Alex Morgan", "1000.00", "80.00", "25", "2026-08"],
    ]);
    const preview = await previewImportPosting(db, statement.id, mapping);
    let blocked: StatementBlockedError | null = null;
    try {
      await postImportStatement(db, statement.id, mapping);
    } catch (error) {
      expect(error).toBeInstanceOf(StatementBlockedError);
      blocked = error as StatementBlockedError;
    }
    expect(blocked).not.toBeNull();
    const response = toErrorResponse(blocked!);
    expect(response.status).toBe(400);
    const body = await response.json() as { posted?: boolean; message?: string };
    expect(body.posted).toBe(false);
    expect(body.message).toMatch(/not posted/i);
    expect(acceptedPostHttpBody(body)).toBe(false);
    expect(shouldCallOnPosted({ httpOk: false, body })).toBe(false);
    expect(statementPostBannerKind({
      httpOk: false,
      error: postRejectionUserMessage(body.message ?? "", preview.readiness.blockers),
      readiness: preview.readiness,
      statement: { status: "mapped", postedRowCount: 0 },
      unmatchedCount: preview.unmatchedGroups.length + preview.unmatchedLines.length,
    })).toBe("error");
  });

  it("4-6. rejected statement stays mapped with zero posted rows and no commission records", async () => {
    const { db } = await seed();
    const statement = await savedStatement(db, [
      ["Beam Co", "CA1", "Principal", "SmartPremium Select", "Alex Morgan", "1329.63", "1329.63", "25", "2026-08"],
    ]);
    await expect(postImportStatement(db, statement.id, mapping)).rejects.toMatchObject({ name: "StatementBlockedError" });
    const after = await getImportStatement(db, statement.id);
    expect(after?.status).toBe("mapped");
    expect(after?.postedRowCount).toBe(0);
    expect(persistedFinancialPostSucceeded({ statement: after })).toBe(false);
    expect(await listCommissions(db)).toHaveLength(0);
  });

  it("7. successful posting reports success only after the transaction commits", async () => {
    const { db } = await seed();
    const statement = await savedStatement(db, [
      ["Acme Benefits", "A1", "Principal", "Dental", "Alex Morgan", "1000.00", "80.00", "25", "2026-08"],
    ]);
    setTransactionFailPoint("import-post-after-mark");
    await expect(postImportStatement(db, statement.id, mapping)).rejects.toThrow(/Forced transaction failure: import-post-after-mark/);
    const afterFailure = await getImportStatement(db, statement.id);
    expect(afterFailure?.status).toBe("mapped");
    expect(afterFailure?.postedRowCount).toBe(0);
    expect(await listCommissions(db)).toHaveLength(0);
    expect(acceptedPostHttpBody({
      posted: true,
      statement: afterFailure,
    })).toBe(false);

    const posted = await postImportStatement(db, statement.id, mapping);
    expect(posted.posted).toBe(true);
    expect(acceptedPostHttpBody(posted)).toBe(true);
    expect(posted.statement.status).toBe("posted");
    expect(posted.statement.postedRowCount).toBe(1);
    expect(posted.postedCount).toBe(1);
  });

  it("8. successful fixture reconciles row count and signed gross", async () => {
    const { db } = await seed();
    const statement = await savedStatement(db, [
      ["Acme Benefits", "A1", "Principal", "Dental", "Alex Morgan", "1000.00", "80.00", "25", "2026-08"],
      ["Acme Benefits", "A1", "Principal", "Dental", "Alex Morgan", "100.00", "-20.00", "25", "2026-08"],
    ]);
    const posted = await postImportStatement(db, statement.id, mapping);
    expect(posted.posted).toBe(true);
    expect(posted.postedCount).toBe(2);
    expect(posted.statement.postedRowCount).toBe(2);
    expect(posted.postedGrossCents).toBe(6000);
    const commissions = await listCommissions(db);
    expect(commissions).toHaveLength(2);
    expect(commissions.reduce((sum, row) => sum + row.grossCommissionCents, 0)).toBe(6000);
    expect(posted.rows.filter((row) => row.status === "posted")).toHaveLength(2);
  });

  it("9. server failure is surfaced visibly and never as posted", async () => {
    const failure = toErrorResponse(new Error("boom"));
    expect(failure.status).toBe(500);
    const body = await failure.json() as { posted?: boolean; message?: string };
    expect(body.posted).toBeUndefined();
    const message = postRejectionUserMessage(body.message ?? "Something went wrong.");
    expect(message).toMatch(/not posted/i);
    expect(statementPostBannerKind({
      httpOk: false,
      error: message,
      statement: { status: "mapped", postedRowCount: 0 },
    })).toBe("error");
    expect(shouldCallOnPosted({ httpOk: false, body: { posted: true, statement: { status: "posted", postedRowCount: 2 } } })).toBe(false);

    const blocked = blockedPostMessage({
      ready: false,
      canContinue: false,
      blockers: [{ kind: "groups", count: 1, message: "1 Group needs review", actionLabel: "Review 1 Group", targetId: "resolve-groups" }],
      reasons: ["1 Group needs review"],
      readyCount: 0,
      blockedCount: 45,
      postedCount: 0,
    }, 45);
    expect(blocked).toMatch(/1 Group needs review/);
    expect(blocked).toMatch(/No commission records were written/);
  });

  it("10. duplicate protection remains intact", async () => {
    const { db } = await seed();
    const statement = await savedStatement(db, [
      ["Acme Benefits", "A1", "Principal", "Dental", "Alex Morgan", "1000.00", "80.00", "25", "2026-08"],
    ]);
    const first = await postImportStatement(db, statement.id, mapping);
    expect(first.postedCount).toBe(1);
    expect(first.posted).toBe(true);
    const second = await postImportStatement(db, statement.id, mapping);
    expect(second.posted).toBe(true);
    expect(second.postedCount).toBe(0);
    expect(second.alreadyPostedCount).toBe(1);
    expect(second.statement.status).toBe("posted");
    expect(second.statement.postedRowCount).toBe(1);
    expect(await listCommissions(db)).toHaveLength(1);
    expect(acceptedPostHttpBody(second)).toBe(true);
  });
});
