import { describe, expect, it } from "vitest";
import { createCarrier } from "./carriers";
import { listAccountManagers } from "./accountManagers";
import { listAgents } from "./agents";
import { listCommissions } from "./commissions";
import { listGroups } from "./groups";
import { inspectStatementUpload } from "./inspectStatement";
import { previewImportPosting } from "./importPosting";
import { confirmPdfStatementLayout, getStatementExtraction } from "./pdfLayoutConfirm";
import { previewPdfStatement } from "./pdfStatements";
import { createImportStatement, getImportStatement } from "./statements";
import { listTeams } from "./teams";
import { createTestDb } from "@/db/test-db";
import { fingerprintBuffer } from "@/domain/fingerprint";
import { saveImportExtractionPath } from "./statements";
import { storeStatementFile } from "@/lib/storage";
import { imageOnlyPdf, readableHiddenTablePdf, textCommissionPdf } from "../../tests/helpers/pdfFixtures";

function extractionArtifact(lines: string[]) {
  return new TextEncoder().encode(JSON.stringify({
    classification: "readable",
    pageCount: 1,
    pages: [{ pageNumber: 1, characterCount: lines.join("\n").length, lines }],
  }));
}

async function savedNeedsLayout(db: Awaited<ReturnType<typeof createTestDb>>, lines: string[], fileName = "hidden-table.pdf") {
  const carrier = await createCarrier(db, { name: `Carrier ${fileName}` });
  const buffer = new TextEncoder().encode(`%PDF-hidden-${fileName}-${lines.join("|")}`);
  const statement = await createImportStatement(db, {
    originalFilename: fileName,
    paidMonth: "2026-09",
    carrierId: carrier.id,
    sourceType: "pdf",
    status: "needs_layout",
    fingerprint: fingerprintBuffer(buffer),
    preview: {
      sheets: [],
      unmatchedGroups: [],
      rowCount: 0,
      newGroupCount: 0,
      pdf: { classification: "needs_layout", pageCount: 1 },
    },
  });
  const extractionPath = await storeStatementFile(statement.id, "extraction.json", extractionArtifact(lines));
  return saveImportExtractionPath(db, statement.id, extractionPath);
}

function findLine(extraction: Awaited<ReturnType<typeof getStatementExtraction>>, pattern: RegExp) {
  for (const page of extraction.pages) {
    const line = page.lines.find((item) => pattern.test(item.text));
    if (line) return line;
  }
  return null;
}

const hiddenLines = [
  "Choice Builder commission statement for the paid month with readable embedded text.",
  "Member    Plan    Paid    Fee",
  "Acme Benefits    Dental    1000.00    80.00",
  "Member    Plan    Paid    Fee",
  "Gamma Group    Dental    250.00    20.00",
  "Subtotal    100.00",
  "Total    100.00",
  "Page 1 of 1",
];

describe("PDF layout confirmation", () => {
  it("keeps automatically detected readable PDF rows on the existing mapping path", async () => {
    const db = await createTestDb();
    const carrier = await createCarrier(db, { name: "Sanitized Mutual" });
    const buffer = await textCommissionPdf();
    const { preview } = await previewPdfStatement(buffer, []);
    expect(preview.rowCount).toBeGreaterThan(0);
    const result = await inspectStatementUpload({
      fileName: "sanitized-commission.pdf",
      mimeType: "application/pdf",
      size: buffer.byteLength,
      buffer,
      paidMonth: "2026-09",
      carrierId: String(carrier.id),
      persist: true,
    }, db);
    expect(result.status).toBe(200);
    expect(result.body.status).toBe("ready_to_map");
    expect((result.body.preview as { rowCount?: number }).rowCount).toBeGreaterThan(0);
  });

  it("opens extracted text for a readable PDF with zero candidates and confirms deterministic rows into mapping", async () => {
    const db = await createTestDb();
    const groupsBefore = (await listGroups(db)).length;
    const statement = await savedNeedsLayout(db, hiddenLines);
    const extraction = await getStatementExtraction(db, statement.id);
    expect(extraction.pages[0]?.lines.some((line) => /Member/.test(line.text))).toBe(true);
    expect(extraction.message).toMatch(/help identifying the commission table/i);

    const header = findLine(extraction, /^Member\s{2,}Plan/);
    const start = findLine(extraction, /^Acme Benefits/);
    const lastData = findLine(extraction, /^Gamma Group/);
    expect(header && start && lastData).toBeTruthy();

    const confirmed = await confirmPdfStatementLayout(db, statement.id, {
      headerPageNumber: header!.pageNumber,
      headerLineNumber: header!.lineNumber,
      dataStartPageNumber: start!.pageNumber,
      dataStartLineNumber: start!.lineNumber,
      dataEndPageNumber: lastData!.pageNumber,
      dataEndLineNumber: hiddenLines.length,
    });

    expect(confirmed.status).toBe("ready_to_map");
    expect(confirmed.preview?.rowCount).toBe(2);
    expect(confirmed.preview?.pdf?.layoutConfirmed).toBe(true);
    expect(confirmed.preview?.sheets[0]?.rows.map((row) => row.sourceIdentity)).toEqual([
      `pdf:page:1:row:${start!.lineNumber}`,
      `pdf:page:1:row:${lastData!.lineNumber}`,
    ]);
    expect(confirmed.preview?.sheets.flatMap((sheet) => sheet.rows.map((row) => row.values.Member))).toEqual([
      "Acme Benefits",
      "Gamma Group",
    ]);

    expect(await listCommissions(db)).toHaveLength(0);
    expect(await listGroups(db)).toHaveLength(groupsBefore);
    expect(await listAgents(db)).toHaveLength(0);
    expect(await listAccountManagers(db)).toHaveLength(0);
    expect(await listTeams(db)).toHaveLength(0);

    const review = await previewImportPosting(db, confirmed.id, {
      groupName: "Member",
      lineOfBusiness: "Plan",
      premium: "Paid",
      grossCommission: "Fee",
    });
    expect(review.rows).toHaveLength(2);
    expect(review.rows.every((row) => row.status === "blocked")).toBe(true);
    expect(await listCommissions(db)).toHaveLength(0);
    expect(await listGroups(db)).toHaveLength(groupsBefore);
  });

  it("makes no financial writes when layout confirmation is not submitted", async () => {
    const db = await createTestDb();
    const statement = await savedNeedsLayout(db, hiddenLines, "cancel-layout.pdf");
    const loaded = await getImportStatement(db, statement.id);
    expect(loaded?.status).toBe("needs_layout");
    expect(loaded?.preview?.rowCount ?? 0).toBe(0);
    expect(await listCommissions(db)).toHaveLength(0);
    expect(await listGroups(db)).toHaveLength(0);
  });

  it("keeps scanned PDFs unsupported and PDF extraction failures on PDF-specific copy", async () => {
    const db = await createTestDb();
    const carrier = await createCarrier(db, { name: "Scan Connector" });
    const scanned = await imageOnlyPdf();
    const scannedResult = await inspectStatementUpload({
      fileName: "scan.pdf",
      mimeType: "application/pdf",
      size: scanned.byteLength,
      buffer: scanned,
      paidMonth: "2026-09",
      carrierId: String(carrier.id),
      persist: true,
    }, db);
    expect(scannedResult.body.status).toBe("unreadable");
    const scannedStatement = scannedResult.body.statement as { id: number };
    await expect(confirmPdfStatementLayout(db, scannedStatement.id, {
      headerPageNumber: 1,
      headerLineNumber: 1,
      dataStartPageNumber: 1,
      dataStartLineNumber: 1,
      dataEndPageNumber: 1,
      dataEndLineNumber: 1,
    })).rejects.toThrow(/scanned or image-based/i);

    const broken = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x34, 0x0a, 0x00, 0x01, 0x02]);
    const failed = await inspectStatementUpload({
      fileName: "broken.pdf",
      mimeType: "application/pdf",
      size: broken.byteLength,
      buffer: broken,
      paidMonth: "2026-09",
      carrierId: String(carrier.id),
      persist: true,
    }, db);
    expect(String(failed.body.message)).toMatch(/PDF extraction failed/i);
    expect(String(failed.body.message)).not.toMatch(/valid CSV or XLSX/i);
    const failedStatement = failed.body.statement as { id: number };
    await expect(confirmPdfStatementLayout(db, failedStatement.id, {
      headerPageNumber: 1,
      headerLineNumber: 1,
      dataStartPageNumber: 1,
      dataStartLineNumber: 1,
      dataEndPageNumber: 1,
      dataEndLineNumber: 1,
    })).rejects.toThrow(/PDF extraction failed/i);
  });

  it("does not change the CSV workflow", async () => {
    const db = await createTestDb();
    const carrier = await createCarrier(db, { name: "CSV Carrier" });
    const buffer = new TextEncoder().encode("Group Name,Commission\nAcme Benefits,80.00\n");
    const result = await inspectStatementUpload({
      fileName: "book.csv",
      mimeType: "text/csv",
      size: buffer.byteLength,
      buffer,
      paidMonth: "2026-09",
      carrierId: String(carrier.id),
      persist: true,
    }, db);
    expect(result.body.status).toBe("ready_to_map");
    expect(result.body.fileType).toBe("csv");
    const statement = result.body.statement as { id: number };
    await expect(confirmPdfStatementLayout(db, statement.id, {
      headerPageNumber: 1,
      headerLineNumber: 1,
      dataStartPageNumber: 1,
      dataStartLineNumber: 2,
      dataEndPageNumber: 1,
      dataEndLineNumber: 2,
    })).rejects.toThrow(/PDF statements/i);
  });

  it("confirms a real extracted hidden-table PDF when automatic detection finds no rows", async () => {
    const db = await createTestDb();
    const carrier = await createCarrier(db, { name: "Choice Builder" });
    const buffer = await readableHiddenTablePdf();
    const inspected = await inspectStatementUpload({
      fileName: "choice-builder.pdf",
      mimeType: "application/pdf",
      size: buffer.byteLength,
      buffer,
      paidMonth: "2026-09",
      carrierId: String(carrier.id),
      persist: true,
    }, db);
    expect(inspected.body.status).toBe("needs_layout");
    const statement = inspected.body.statement as { id: number };
    const extraction = await getStatementExtraction(db, statement.id);
    expect(extraction.pages.some((page) => page.lines.length > 0)).toBe(true);
    const header = findLine(extraction, /Member/);
    const start = findLine(extraction, /Acme Benefits/);
    const end = findLine(extraction, /Gamma Group/) ?? extraction.pages[0]?.lines.at(-1);
    expect(header && start && end).toBeTruthy();
    const confirmed = await confirmPdfStatementLayout(db, statement.id, {
      headerPageNumber: header!.pageNumber,
      headerLineNumber: header!.lineNumber,
      dataStartPageNumber: start!.pageNumber,
      dataStartLineNumber: start!.lineNumber,
      dataEndPageNumber: end!.pageNumber,
      dataEndLineNumber: end!.lineNumber,
    });
    expect(confirmed.preview?.rowCount).toBeGreaterThan(0);
    expect(await listCommissions(db)).toHaveLength(0);
  });
});
