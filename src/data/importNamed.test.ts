import { describe, expect, it } from "vitest";
import { createAgreement, listAgreements } from "./agreements";
import { createAgent, listAgents } from "./agents";
import { createCarrier } from "./carriers";
import { createGroup, listGroups } from "./groups";
import { listCarrierCoverageAliases, rememberCarrierCoverageAlias } from "./carrierCoverage";
import { listCommissions } from "./commissions";
import { confirmImportAgents, confirmImportLines } from "./importNamed";
import { confirmImportGroups } from "./importGroups";
import { postImportStatement, previewImportPosting } from "./importPosting";
import { createLineOfBusiness, listLinesOfBusiness } from "./linesOfBusiness";
import { createImportStatement } from "./statements";
import { createTestDb } from "@/db/test-db";
import type { ColumnMapping } from "@/domain/columnMapping";
import { fingerprintBuffer } from "@/domain/fingerprint";
import { previewWorkbook } from "@/domain/workbook";
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

async function workbook(rows: string[][]) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Commissions");
  sheet.addRow(["Group Name", "Group Number", "Carrier", "LOB", "Agent", "Premium", "Commission", "Premium Month"]);
  for (const row of rows) sheet.addRow(row);
  return new Uint8Array(await book.xlsx.writeBuffer());
}

describe("statement named-entity review", () => {
  it("surfaces unmatched groups, lines, and agents and enables continuation after intentional confirmation", async () => {
    const db = await createTestDb();
    const group = await createGroup(db, { name: "Acme Benefits", groupNumber: "A1" });
    const carrier = await createCarrier(db, { name: "Principal" });
    const line = await createLineOfBusiness(db, { name: "Dental" });
    const agent = await createAgent(db, { name: "Alex Morgan" });
    await createAgreement(db, {
      groupId: group.id,
      agentId: agent.id,
      lineOfBusinessId: line.id,
      compensationBps: 4000,
      effectiveStart: "2026-01",
    });
    const buffer = await workbook([
      ["New Speech", "NS-1", "Principal", "PPO Dental", "Pat Lee", "1000.00", "80.00", "2026-07"],
    ]);
    const statement = await createImportStatement(db, {
      originalFilename: "named.xlsx",
      paidMonth: "2026-08",
      carrierId: carrier.id,
      sourceType: "excel",
      status: "ready_to_map",
      fingerprint: fingerprintBuffer(buffer),
      preview: await previewWorkbook(buffer, await listGroups(db)),
    });

    const blocked = await previewImportPosting(db, statement.id, mapping);
    expect(blocked.readiness.canContinue).toBe(false);
    expect(blocked.readiness.blockers.map((item) => item.kind)).toEqual(["groups", "lines", "agents"]);
    expect(blocked.unmatchedGroups).toHaveLength(1);
    expect(blocked.unmatchedLines[0]?.sourceName).toBe("PPO Dental");
    expect(blocked.unmatchedAgents[0]?.sourceName).toBe("Pat Lee");

    await confirmImportGroups(db, statement.id, mapping, blocked.unmatchedGroups.map((item) => ({ key: item.key, action: "create" })));
    const afterGroups = await previewImportPosting(db, statement.id, mapping);
    expect(afterGroups.readiness.blockers.map((item) => item.kind)).toEqual(["lines", "agents"]);

    await confirmImportLines(db, statement.id, mapping, afterGroups.unmatchedLines.map((item) => ({ key: item.key, action: "create" })));
    const afterLines = await previewImportPosting(db, statement.id, mapping);
    expect(afterLines.unmatchedLines).toHaveLength(0);
    expect((await listLinesOfBusiness(db)).map((item) => item.name)).toContain("PPO Dental");

    const agreementsBefore = (await listAgreements(db)).length;
    await confirmImportAgents(db, statement.id, mapping, afterLines.unmatchedAgents.map((item) => ({ key: item.key, action: "create" })));
    expect((await listAgreements(db))).toHaveLength(agreementsBefore);
    expect((await listAgents(db)).some((item) => item.name === "Pat Lee" && item.defaultCompensationBps == null)).toBe(true);

    const ready = await previewImportPosting(db, statement.id, mapping);
    expect(ready.readiness.canContinue).toBe(true);
    expect(ready.readyCount).toBe(1);
    expect(ready.rows[0]?.compensationBps).toBe(0);

    const posted = await postImportStatement(db, statement.id, mapping);
    expect(posted.postedCount).toBe(1);
    expect(posted.rows[0]?.status).toBe("posted");
  });

  it("matches an existing line of business and does not create compensation", async () => {
    const db = await createTestDb();
    await createGroup(db, { name: "Acme Benefits", groupNumber: "A1" });
    await createCarrier(db, { name: "Principal" });
    const dental = await createLineOfBusiness(db, { name: "Dental" });
    await createAgent(db, { name: "Alex Morgan" });
    const buffer = await workbook([
      ["Acme Benefits", "A1", "Principal", "PPO Dental", "Alex Morgan", "1000.00", "80.00", "2026-07"],
    ]);
    const statement = await createImportStatement(db, {
      originalFilename: "lob.xlsx",
      paidMonth: "2026-08",
      carrierId: null,
      sourceType: "excel",
      status: "ready_to_map",
      fingerprint: fingerprintBuffer(buffer),
      preview: await previewWorkbook(buffer, await listGroups(db)),
    });
    const review = await previewImportPosting(db, statement.id, mapping);
    const confirmed = await confirmImportLines(db, statement.id, mapping, [
      { key: review.unmatchedLines[0]!.key, action: "match", existingId: dental.id },
    ]);
    expect(confirmed.rows[0]?.lineOfBusinessId).toBe(dental.id);
    expect(confirmed.unmatchedLines).toHaveLength(0);
    expect(await listAgreements(db)).toHaveLength(0);
  });

  it("learns a carrier-scoped coverage value and does not rewrite posted commissions", async () => {
    const db = await createTestDb();
    await createGroup(db, { name: "Acme Benefits", groupNumber: "A1" });
    const anthem = await createCarrier(db, { name: "Anthem" });
    const principal = await createCarrier(db, { name: "Principal" });
    const vision = await createLineOfBusiness(db, { name: "Group Vision" });
    const dental = await createLineOfBusiness(db, { name: "Dental" });
    await createAgent(db, { name: "Alex Morgan" });

    const firstBuffer = await workbook([
      ["Acme Benefits", "A1", "Anthem", "VIS", "Alex Morgan", "1000.00", "80.00", "2026-07"],
    ]);
    const first = await createImportStatement(db, {
      originalFilename: "anthem-1.xlsx",
      paidMonth: "2026-08",
      carrierId: anthem.id,
      sourceType: "excel",
      status: "ready_to_map",
      fingerprint: fingerprintBuffer(firstBuffer),
      preview: await previewWorkbook(firstBuffer, await listGroups(db)),
    });
    const firstReview = await previewImportPosting(db, first.id, mapping);
    expect(firstReview.unmatchedLines[0]?.sourceName).toBe("VIS");
    await confirmImportLines(db, first.id, mapping, [
      { key: firstReview.unmatchedLines[0]!.key, action: "match", existingId: vision.id },
    ]);
    expect((await listCarrierCoverageAliases(db, anthem.id)).map((item) => item.sourceValue)).toEqual(["vis"]);

    const posted = await postImportStatement(db, first.id, mapping);
    expect(posted.postedCount).toBe(1);
    const postedCommission = (await listCommissions(db))[0];
    expect(postedCommission?.lineOfBusinessId).toBe(vision.id);

    const laterBuffer = await workbook([
      ["Acme Benefits", "A1", "Anthem", "VIS", "Alex Morgan", "900.00", "72.00", "2026-08"],
    ]);
    const later = await createImportStatement(db, {
      originalFilename: "anthem-2.xlsx",
      paidMonth: "2026-09",
      carrierId: anthem.id,
      sourceType: "excel",
      status: "ready_to_map",
      fingerprint: fingerprintBuffer(laterBuffer),
      preview: await previewWorkbook(laterBuffer, await listGroups(db)),
    });
    const laterReview = await previewImportPosting(db, later.id, mapping);
    expect(laterReview.unmatchedLines).toHaveLength(0);
    expect(laterReview.rows[0]?.lineOfBusinessId).toBe(vision.id);

    const otherBuffer = await workbook([
      ["Acme Benefits", "A1", "Principal", "VIS", "Alex Morgan", "500.00", "40.00", "2026-08"],
    ]);
    const other = await createImportStatement(db, {
      originalFilename: "principal-1.xlsx",
      paidMonth: "2026-09",
      carrierId: principal.id,
      sourceType: "excel",
      status: "ready_to_map",
      fingerprint: fingerprintBuffer(otherBuffer),
      preview: await previewWorkbook(otherBuffer, await listGroups(db)),
    });
    const otherReview = await previewImportPosting(db, other.id, mapping);
    expect(otherReview.unmatchedLines[0]?.sourceName).toBe("VIS");

    await rememberCarrierCoverageAlias(db, {
      carrierId: anthem.id,
      sourceValue: "VIS",
      lineOfBusinessId: dental.id,
    });
    const afterOverride = await listCommissions(db);
    expect(afterOverride[0]?.id).toBe(postedCommission?.id);
    expect(afterOverride[0]?.lineOfBusinessId).toBe(vision.id);
  });
});
