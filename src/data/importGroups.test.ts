import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAgreement, listAgreements } from "./agreements";
import { createAgent, listAgents } from "./agents";
import { createCarrier } from "./carriers";
import { listCommissions } from "./commissions";
import { createGroup, listGroups } from "./groups";
import { confirmImportGroups, reviewImportGroups } from "./importGroups";
import { postImportStatement, previewImportPosting } from "./importPosting";
import { createLineOfBusiness } from "./linesOfBusiness";
import { createImportStatement } from "./statements";
import { createTestDb } from "@/db/test-db";
import { suggestColumnMapping, type ColumnMapping } from "@/domain/columnMapping";
import { fingerprintBuffer } from "@/domain/fingerprint";
import { previewCsv, previewWorkbook } from "@/domain/workbook";
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
) {
  const buffer = await workbook(rows);
  return await createImportStatement(db, {
    originalFilename: "principal.xlsx",
    paidMonth: "2026-08",
    carrierId: null,
    sourceType: "excel",
    status: "ready_to_map",
    fingerprint: fingerprintBuffer(buffer),
    preview: await previewWorkbook(buffer, await listGroups(db)),
  });
}

describe("statement import group onboarding", () => {
  it("reviews unique unmatched groups from a CSV without creating them at upload", async () => {
    const { db } = await seed();
    const statement = await savedStatement(db, [
      ["Empower Speech", "ES-9", "Principal", "Dental", "Alex Morgan", "1000.00", "80.00", "", "2026-07"],
      ["empower  speech", "ES-9", "Principal", "Dental", "Alex Morgan", "500.00", "40.00", "", "2026-07"],
      ["Beta Co", "B2", "Principal", "Dental", "Alex Morgan", "200.00", "20.00", "", "2026-07"],
    ]);

    const review = await reviewImportGroups(db, statement.id, mapping);
    expect(review.unmatchedGroups).toHaveLength(2);
    expect(review.unmatchedGroups.map((group) => group.sourceName)).toEqual(["Beta Co", "Empower Speech"]);
    expect(review.unmatchedGroups.find((group) => group.sourceName === "Empower Speech")?.rowCount).toBe(2);
    expect((await listGroups(db)).map((group) => group.name)).toEqual(["Acme Benefits"]);
  });

  it("creates one group per confirmed unique name and posts those durable IDs", async () => {
    const { db } = await seed();
    const statement = await savedStatement(db, [
      ["Empower Speech", "ES-9", "Principal", "Dental", "Alex Morgan", "1000.00", "80.00", "", "2026-07"],
      ["Empower Speech", "ES-9", "Principal", "Dental", "Alex Morgan", "500.00", "40.00", "", "2026-07"],
      ["Gamma LLC", "G3", "Principal", "Dental", "Alex Morgan", "200.00", "20.00", "", "2026-07"],
    ]);

    const review = await reviewImportGroups(db, statement.id, mapping);
    const confirmed = await confirmImportGroups(
      db,
      statement.id,
      mapping,
      review.unmatchedGroups.map((group) => ({ key: group.key, action: "create" })),
    );
    expect(confirmed.createdCount).toBe(2);
    expect(confirmed.remainingUnmatchedCount).toBe(0);
    const names = (await listGroups(db)).map((group) => group.name).sort();
    expect(names).toEqual(["Acme Benefits", "Empower Speech", "Gamma LLC"]);
    expect((await listGroups(db)).filter((group) => group.name === "Empower Speech")).toHaveLength(1);

    const posted = await postImportStatement(db, statement.id, mapping);
    expect(posted.postedCount).toBe(3);
    const commissions = await listCommissions(db);
    const groups = await listGroups(db);
    const empowerId = groups.find((group) => group.name === "Empower Speech")?.id;
    const gammaId = groups.find((group) => group.name === "Gamma LLC")?.id;
    expect(commissions.filter((row) => row.groupId === empowerId)).toHaveLength(2);
    expect(commissions.filter((row) => row.groupId === gammaId)).toHaveLength(1);
    expect(commissions.every((row) => row.notes?.includes("Source group:"))).toBe(true);
    expect(commissions.find((row) => row.groupId === empowerId)?.notes).toContain("Empower Speech");
  });

  it("matches an unmatched name to an existing group without overwriting that group", async () => {
    const { db, group } = await seed();
    const statement = await savedStatement(db, [
      ["Empower Speech", "ES-9", "Principal", "Dental", "Alex Morgan", "1000.00", "80.00", "", "2026-07"],
    ]);
    const review = await reviewImportGroups(db, statement.id, mapping);
    const confirmed = await confirmImportGroups(db, statement.id, mapping, [
      { key: review.unmatchedGroups[0]!.key, action: "match", existingGroupId: group.id },
    ]);
    expect(confirmed.createdCount).toBe(0);
    expect(confirmed.matchedCount).toBe(1);
    expect(confirmed.statement.preview?.groupResolutions?.[0]).toMatchObject({
      action: "match",
      groupId: group.id,
      sourceName: "Empower Speech",
      sourceNumber: "ES-9",
    });
    expect(confirmed.conflicts[0]).toMatch(/different group number/);
    expect((await listGroups(db)).map((item) => item.name)).toEqual(["Acme Benefits"]);
    expect((await listGroups(db))[0]?.groupNumber).toBe("A1");

    const preview = await previewImportPosting(db, statement.id, mapping);
    expect(preview.rows[0]?.status).toBe("ready");
    expect(preview.rows[0]?.groupId).toBe(group.id);
    expect(preview.rows[0]?.importedGroupName).toBe("Empower Speech");
    expect((await postImportStatement(db, statement.id, mapping)).postedCount).toBe(1);
    expect((await listCommissions(db))[0]?.groupId).toBe(group.id);
    expect((await listCommissions(db))[0]?.notes).toContain("Source group: Empower Speech");
  });

  it("requires confirmation when a normalized name has a conflicting group number", async () => {
    const { db } = await seed();
    const existing = await createGroup(db, { name: "  EMPOWER   SPEECH ", groupNumber: "other" });
    const statement = await savedStatement(db, [
      ["Empower Speech", "ES-9", "Principal", "Dental", "Alex Morgan", "1000.00", "80.00", "", "2026-07"],
    ]);
    const review = await reviewImportGroups(db, statement.id, mapping);
    expect(review.unmatchedGroups).toHaveLength(1);
    expect(review.rows[0]?.groupId).toBeNull();
    const confirmed = await confirmImportGroups(db, statement.id, mapping, [
      { key: review.unmatchedGroups[0]!.key, action: "match", existingGroupId: existing.id },
    ]);
    expect(confirmed.remainingUnmatchedCount).toBe(0);
    expect((await listGroups(db)).filter((group) => group.name.toLowerCase().includes("empower"))).toHaveLength(1);
    expect(existing.groupNumber).toBe("other");
    expect((await postImportStatement(db, statement.id, mapping)).postedCount).toBe(1);
    expect((await listCommissions(db))[0]?.groupId).toBe(existing.id);
  });

  it("reuses a normalized existing group instead of creating a duplicate on retry", async () => {
    const { db } = await seed();
    const statement = await savedStatement(db, [
      ["Empower Speech", "ES-9", "Principal", "Dental", "Alex Morgan", "1000.00", "80.00", "", "2026-07"],
    ]);
    const review = await reviewImportGroups(db, statement.id, mapping);
    const first = await confirmImportGroups(db, statement.id, mapping, [
      { key: review.unmatchedGroups[0]!.key, action: "create" },
    ]);
    const second = await confirmImportGroups(db, statement.id, mapping, [
      { key: review.unmatchedGroups[0]!.key, action: "create" },
    ]);
    expect(first.createdCount).toBe(1);
    expect(second.createdCount).toBe(0);
    expect((await listGroups(db)).filter((group) => group.name.toLowerCase() === "empower speech")).toHaveLength(1);
  });

  it("does not create groups when confirmation fails validation", async () => {
    const { db } = await seed();
    const statement = await savedStatement(db, [
      ["Empower Speech", "ES-9", "Principal", "Dental", "Alex Morgan", "1000.00", "80.00", "", "2026-07"],
      ["Gamma LLC", "G3", "Principal", "Dental", "Alex Morgan", "200.00", "20.00", "", "2026-07"],
    ]);
    const review = await reviewImportGroups(db, statement.id, mapping);
    await expect(confirmImportGroups(db, statement.id, mapping, [
      { key: review.unmatchedGroups[0]!.key, action: "create" },
      { key: review.unmatchedGroups[1]!.key, action: "match", existingGroupId: null },
    ])).rejects.toThrow(/Select an existing group/);
    expect((await listGroups(db)).map((group) => group.name)).toEqual(["Acme Benefits"]);
  });

  it("does not create compensation or people when confirming new groups", async () => {
    const { db, group, agent, lineOfBusiness } = await seed();
    await createAgreement(db, {
      groupId: group.id,
      agentId: agent.id,
      lineOfBusinessId: lineOfBusiness.id,
      compensationBps: 4000,
      effectiveStart: "2026-01",
    });
    const agentsBefore = await listAgents(db);
    const statement = await savedStatement(db, [
      ["Empower Speech", "ES-9", "Principal", "Dental", "Unknown Producer", "1000.00", "80.00", "", "2026-07"],
    ]);
    const review = await reviewImportGroups(db, statement.id, mapping);
    await confirmImportGroups(db, statement.id, mapping, [
      { key: review.unmatchedGroups[0]!.key, action: "create" },
    ]);
    const created = (await listGroups(db)).find((item) => item.name === "Empower Speech");
    expect(created?.accountManagerId).toBeNull();
    expect(created?.primaryAgentId).toBeNull();
    expect(created?.defaultCompensationBps).toBeNull();
    expect(await listAgreements(db)).toHaveLength(1);
    expect((await listAgreements(db))[0]?.groupId).toBe(group.id);
    expect((await listAgreements(db))[0]?.compensationBps).toBe(4000);
    expect(await listAgents(db)).toHaveLength(agentsBefore.length);
    const preview = await previewImportPosting(db, statement.id, mapping);
    expect(preview.rows[0]?.exceptions.join(" ")).toMatch(/Unmatched agent/);
    expect(preview.rows[0]?.groupId).toBe(created?.id);
    expect(preview.rows[0]?.status).toBe("blocked");
  });

  it("onboards unmatched Anthem fixture groups and posts them to durable group IDs", async () => {
    const db = await createTestDb();
    const carrier = await createCarrier(db, { name: "Anthem" });
    await createLineOfBusiness(db, { name: "MED" });
    const buffer = fs.readFileSync(path.join(process.cwd(), "tests/fixtures/anthem-08-2026.csv"));
    const preview = previewCsv(buffer, []);
    const anthemMapping = { ...suggestColumnMapping(preview.sheets[0].headers), agent: null };
    const statement = await createImportStatement(db, {
      originalFilename: "anthem-08-2026.csv",
      paidMonth: "2026-08",
      carrierId: carrier.id,
      sourceType: "csv",
      status: "ready_to_map",
      fingerprint: fingerprintBuffer(buffer),
      preview,
    });

    const review = await reviewImportGroups(db, statement.id, anthemMapping);
    expect(review.unmatchedGroups.length).toBeGreaterThan(0);
    expect(review.unmatchedGroups.map((group) => group.sourceName)).toEqual([
      "EXAMPLE DENTAL GROUP",
      "EXAMPLE SPEECH GROUP",
    ]);
    const confirmed = await confirmImportGroups(
      db,
      statement.id,
      anthemMapping,
      review.unmatchedGroups.map((group) => ({ key: group.key, action: "create" })),
    );
    expect(confirmed.createdCount).toBe(2);
    expect(await listAgreements(db)).toHaveLength(0);
    const posted = await postImportStatement(db, statement.id, anthemMapping);
    expect(posted.postedCount).toBe(preview.rowCount);
    const commissions = await listCommissions(db);
    expect(commissions.every((row) => row.groupId != null)).toBe(true);
    expect(new Set(commissions.map((row) => row.groupId)).size).toBe(2);
    expect(commissions.every((row) => (row.compensationBps ?? 0) === 0)).toBe(true);
    expect(commissions.every((row) => row.agentCompensationCents === 0)).toBe(true);
    expect(commissions.every((row) => (row.notes ?? "").includes("Source group: EXAMPLE"))).toBe(true);
  });
});
