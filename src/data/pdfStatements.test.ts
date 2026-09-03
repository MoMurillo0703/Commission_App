import { describe, expect, it } from "vitest";
import { createAgreement, listAgreements } from "./agreements";
import { createAgent } from "./agents";
import { createCarrier } from "./carriers";
import { listCommissions } from "./commissions";
import { createGroup, listGroups } from "./groups";
import { postImportStatement, previewImportPosting } from "./importPosting";
import { createLineOfBusiness } from "./linesOfBusiness";
import { previewPdfStatement } from "./pdfStatements";
import { findMatchingLayout, saveCarrierStatementLayout } from "./statementLayouts";
import { createImportStatement } from "./statements";
import { createTestDb } from "@/db/test-db";
import { suggestColumnMapping } from "@/domain/columnMapping";
import { fingerprintBuffer } from "@/domain/fingerprint";
import { buildLayoutSignature } from "@/domain/pdfLayout";
import { isUnparsedStatement } from "@/domain/statementWorkflow";
import { imageOnlyPdf, textCommissionPdf } from "../../tests/helpers/pdfFixtures";

describe("PDF statement intake", () => {
  it("reads a text PDF, ignores totals, and posts through the existing review pipeline", async () => {
    const db = await createTestDb();
    const group = await createGroup(db, { name: "Acme Benefits", groupNumber: "A1" });
    await createGroup(db, { name: "Gamma Group", groupNumber: "G3" });
    const carrier = await createCarrier(db, { name: "Sanitized Mutual" });
    const line = await createLineOfBusiness(db, { name: "Dental" });
    const agent = await createAgent(db, { name: "Alex Morgan" });
    await createAgreement(db, {
      groupId: group.id,
      agentId: agent.id,
      lineOfBusinessId: line.id,
      compensationBps: 2500,
      effectiveStart: "2026-01",
    });
    const buffer = await textCommissionPdf(2);
    const { extraction, preview } = await previewPdfStatement(buffer, await listGroups(db));
    expect(extraction.classification).toBe("readable");
    expect(preview.rowCount).toBe(2);
    expect(preview.sheets.every((sheet) => sheet.rows.every((row) => row.pageNumber))).toBe(true);
    expect(preview.sheets.flatMap((sheet) => sheet.rows.map((row) => row.values["Group Name"]))).not.toContain("Total");

    const statement = await createImportStatement(db, {
      originalFilename: "sanitized-commission.pdf",
      paidMonth: "2026-08",
      carrierId: carrier.id,
      sourceType: "pdf",
      status: "ready_to_map",
      fingerprint: fingerprintBuffer(buffer),
      preview,
    });
    expect(isUnparsedStatement(statement, true)).toBe(false);
    const mapping = suggestColumnMapping(preview.sheets[0]!.headers);
    const review = await previewImportPosting(db, statement.id, mapping);
    expect(review.readyCount).toBeGreaterThan(0);
    expect(review.rows.every((row) => !row.exceptions.some((item) => /total/i.test(item)))).toBe(true);
    const posted = await postImportStatement(db, statement.id, mapping);
    expect(posted.postedCount).toBeGreaterThan(0);
    const commissions = await listCommissions(db);
    expect(commissions.find((row) => row.groupName === "Acme Benefits")?.compensationBps).toBe(2500);
    expect(commissions.find((row) => row.groupName === "Gamma Group")?.compensationBps).toBe(0);
    expect(commissions.every((row) => row.sourceRowKey?.startsWith("pdf:page:"))).toBe(true);
    expect(await listAgreements(db)).toHaveLength(1);
  });

  it("classifies scanned PDFs as unreadable and refuses posting", async () => {
    const db = await createTestDb();
    const carrier = await createCarrier(db, { name: "Sanitized Mutual" });
    const buffer = await imageOnlyPdf();
    const { extraction, preview } = await previewPdfStatement(buffer, []);
    expect(extraction.classification).toBe("unreadable");
    expect(preview.rowCount).toBe(0);
    const statement = await createImportStatement(db, {
      originalFilename: "scan.pdf",
      paidMonth: "2026-08",
      carrierId: carrier.id,
      sourceType: "pdf",
      status: "unreadable",
      fingerprint: fingerprintBuffer(buffer),
      preview,
    });
    expect(isUnparsedStatement(statement)).toBe(true);
    await expect(previewImportPosting(db, statement.id, {})).rejects.toThrow(/no readable rows/i);
    await expect(postImportStatement(db, statement.id, {})).rejects.toThrow(/no readable rows/i);
    expect(await listCommissions(db)).toHaveLength(0);
  });

  it("does not invent rows when extraction fails", async () => {
    const { extraction, preview } = await previewPdfStatement(new Uint8Array([1, 2, 3, 4]), []);
    expect(extraction.classification).toBe("failed");
    expect(preview.rowCount).toBe(0);
    expect(preview.sheets).toEqual([]);
  });

  it("reuses a recognized layout version without rewriting the prior version", async () => {
    const db = await createTestDb();
    const carrier = await createCarrier(db, { name: "Sanitized Mutual" });
    const buffer = await textCommissionPdf();
    const { preview } = await previewPdfStatement(buffer, []);
    const mapping = suggestColumnMapping(preview.sheets[0]!.headers);
    const signature = buildLayoutSignature(preview.sheets[0]!.headers, "SANITIZED CARRIER COMMISSION STATEMENT");
    const first = await saveCarrierStatementLayout(db, {
      carrierId: carrier.id,
      name: "Sanitized Mutual statement layout",
      mapping,
      signature,
    });
    expect(first.version).toBe(1);
    const changed = await saveCarrierStatementLayout(db, {
      carrierId: carrier.id,
      name: "Sanitized Mutual statement layout",
      mapping: { ...mapping, notes: "Commission" },
      signature,
    });
    expect(changed.version).toBe(2);
    expect(changed.id).not.toBe(first.id);
    const match = await findMatchingLayout(db, carrier.id, signature);
    expect(match?.id).toBe(changed.id);
    expect(match?.version).toBe(2);
  });

  it("increments a friendly layout name across distinct signatures", async () => {
    const db = await createTestDb();
    const carrier = await createCarrier(db, { name: "Sanitized Mutual" });
    const name = "Sanitized Mutual statement layout";
    const first = await saveCarrierStatementLayout(db, {
      carrierId: carrier.id,
      name,
      mapping: { groupName: "Group Name", grossCommission: "Commission" },
      signature: buildLayoutSignature(["Group Name", "Commission"], "SANITIZED FORMAT A"),
    });
    const second = await saveCarrierStatementLayout(db, {
      carrierId: carrier.id,
      name,
      mapping: { groupName: "Account", grossCommission: "Gross" },
      signature: buildLayoutSignature(["Account", "Gross"], "SANITIZED FORMAT B"),
    });
    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(second.id).not.toBe(first.id);
  });
});
