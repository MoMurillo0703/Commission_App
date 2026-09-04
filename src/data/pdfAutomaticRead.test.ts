import { describe, expect, it } from "vitest";
import { createCarrier } from "./carriers";
import { listCommissions } from "./commissions";
import { recoverAutomaticPdfRead } from "./pdfAutomaticRead";
import { inspectStatementUpload } from "./inspectStatement";
import { createImportStatement, getImportStatement, saveImportExtractionPath } from "./statements";
import { createTestDb } from "@/db/test-db";
import { fingerprintBuffer } from "@/domain/fingerprint";
import { storeStatementFile } from "@/lib/storage";
import { pdfIntakeSurface } from "@/domain/pdfIntakeSurface";
import { choiceBuilderStatementLines, readableHiddenTablePdf, imageOnlyPdf, textCommissionPdf } from "../../tests/helpers/pdfFixtures";

describe("automatic PDF read recovery and intake", () => {
  it("recovers an old needs_layout Choice Builder extraction into confirmation rows", async () => {
    const db = await createTestDb();
    const carrier = await createCarrier(db, { name: "Choice Builder" });
    const buffer = await readableHiddenTablePdf();
    const inspected = await inspectStatementUpload({
      fileName: "Choice Builder - 08 2026.PDF",
      mimeType: "application/pdf",
      size: buffer.byteLength,
      buffer,
      paidMonth: "2026-08",
      carrierId: String(carrier.id),
      persist: true,
    }, db);
    const created = inspected.body.statement as { id: number; status: string; preview?: { rowCount?: number } };
    expect(created.status).toBe("mapped");
    expect(created.preview?.rowCount).toBeGreaterThan(0);
    const surface = pdfIntakeSurface({
      status: created.status,
      sourceType: "pdf",
      hasReadableRows: true,
      readyCount: created.preview?.rowCount,
      blockedCount: 0,
      statementCarrierName: "Choice Builder",
    });
    expect(surface.kind).toBe("extracted_confirmation");
    expect(surface.showMapping).toBe(false);
    expect(surface.showAgent).toBe(false);
    expect(surface.showAgentSplit).toBe(false);
    expect(surface.showCarrierMapping).toBe(false);
    expect(await listCommissions(db)).toHaveLength(0);

    const leftover = await createImportStatement(db, {
      originalFilename: "old-choice-builder.pdf",
      paidMonth: "2026-08",
      carrierId: carrier.id,
      sourceType: "pdf",
      status: "needs_layout",
      fingerprint: fingerprintBuffer(new TextEncoder().encode("old-choice-builder-needs-layout")),
      preview: {
        sheets: [],
        unmatchedGroups: [],
        rowCount: 0,
        newGroupCount: 0,
        pdf: { classification: "needs_layout", pageCount: 1 },
      },
    });
    const extractionPath = await storeStatementFile(leftover.id, "extraction.json", new TextEncoder().encode(JSON.stringify({
      classification: "readable",
      pageCount: 1,
      pages: [{
        pageNumber: 1,
        lines: choiceBuilderStatementLines,
      }],
    })));
    const stored = await saveImportExtractionPath(db, leftover.id, extractionPath);
    const recovered = await recoverAutomaticPdfRead(db, stored);
    expect(recovered.preview?.rowCount).toBe(6);
    expect(recovered.status === "ready_to_map" || recovered.status === "mapped").toBe(true);
    expect(recovered.columnMapping).toMatchObject({
      groupName: "Company Name",
      lineOfBusiness: "Product",
      grossCommission: "Comm Amount",
      premiumMonth: "Paid Month",
    });
    expect(await getImportStatement(db, leftover.id)).toMatchObject({ id: leftover.id });
    expect(await listCommissions(db)).toHaveLength(0);
  });

  it("keeps scanned PDFs unsupported and readable standard PDFs on confirmation", async () => {
    const db = await createTestDb();
    const carrier = await createCarrier(db, { name: "Scan Carrier" });
    const scanned = await imageOnlyPdf();
    const scannedResult = await inspectStatementUpload({
      fileName: "scan.pdf",
      mimeType: "application/pdf",
      size: scanned.byteLength,
      buffer: scanned,
      paidMonth: "2026-08",
      carrierId: String(carrier.id),
      persist: true,
    }, db);
    expect(scannedResult.body.status).toBe("unreadable");
    expect(pdfIntakeSurface({
      status: "unreadable",
      sourceType: "pdf",
      hasReadableRows: false,
      pdfClassification: "unreadable",
    }).kind).toBe("scanned_unsupported");

    const readable = await textCommissionPdf();
    const readableResult = await inspectStatementUpload({
      fileName: "readable.pdf",
      mimeType: "application/pdf",
      size: readable.byteLength,
      buffer: readable,
      paidMonth: "2026-08",
      carrierId: String(carrier.id),
      persist: true,
    }, db);
    expect(["ready_to_map", "mapped"]).toContain(readableResult.body.status);
    expect((readableResult.body.preview as { rowCount?: number }).rowCount).toBeGreaterThan(0);
    expect(await listCommissions(db)).toHaveLength(0);
  });
});
