import { describe, expect, it } from "vitest";
import { createCarrier } from "./carriers";
import { rememberCarrierCoverageAlias } from "./carrierCoverage";
import { listCommissions } from "./commissions";
import { createGroup, listGroups } from "./groups";
import { inspectStatementUpload } from "./inspectStatement";
import { previewImportPosting } from "./importPosting";
import { createLineOfBusiness } from "./linesOfBusiness";
import { previewPdfStatement } from "./pdfStatements";
import { createImportStatement } from "./statements";
import { createTestDb } from "@/db/test-db";
import { mappingFieldLabels, mappingFields, omitStatementCompensationMapping, suggestColumnMapping } from "@/domain/columnMapping";
import { fingerprintBuffer } from "@/domain/fingerprint";
import { pdfIntakeSurface } from "@/domain/pdfIntakeSurface";
import { candidateRowsFromPdfPages } from "@/domain/pdfExtraction";
import { inferPdfStatementStructure } from "@/domain/pdfStructureInference";
import { previewCsv } from "@/domain/workbook";
import {
  choiceBuilderStatementPdf,
  imageOnlyPdf,
  textCommissionPdf,
  unrecognizedHeaderTablePdf,
} from "../../tests/helpers/pdfFixtures";

describe("production PDF intake acceptance", () => {
  it("1-2 readable PDF rows appear as confirmation, not mapping, and only exceptions stay flagged", async () => {
    const db = await createTestDb();
    const carrier = await createCarrier(db, { name: "Choice Builder" });
    const buffer = await choiceBuilderStatementPdf();
    const inspected = await inspectStatementUpload({
      fileName: "Choice Builder - 08 2026.PDF",
      mimeType: "application/pdf",
      size: buffer.byteLength,
      buffer,
      paidMonth: "2026-08",
      carrierId: String(carrier.id),
      persist: true,
    }, db);
    const preview = inspected.body.preview as { rowCount?: number; sheets?: Array<{ rows?: Array<{ values?: Record<string, string> }> }> };
    expect(preview.rowCount).toBeGreaterThan(0);
    expect(preview.sheets?.[0]?.rows?.[0]?.values?.["Company Name"] ?? preview.sheets?.[0]?.rows?.[0]?.values?.Member).toBeTruthy();
    const surface = pdfIntakeSurface({
      status: String(inspected.body.status),
      sourceType: "pdf",
      hasReadableRows: true,
      readyCount: 1,
      blockedCount: 1,
      statementCarrierName: "Choice Builder",
    });
    expect(surface.kind).toBe("partial_confirmation");
    expect(surface.showMapping).toBe(false);
    expect(surface.showAgent).toBe(false);
    expect(surface.showAgentSplit).toBe(false);
    expect(surface.showCarrierMapping).toBe(false);
    expect(await listCommissions(db)).toHaveLength(0);
  });

  it("3-4 zero first-pass rows still infer automatically; true structure failure offers help only", async () => {
    const unrecognized = await unrecognizedHeaderTablePdf();
    const inferred = await previewPdfStatement(unrecognized, []);
    expect(inferred.extraction.classification).toBe("readable");
    expect(inferred.preview.rowCount).toBe(2);
    expect(inferred.mapping?.agent).toBeUndefined();
    expect(inferred.mapping?.grossCommission).toBeTruthy();

    const pages = [{
      pageNumber: 1,
      text: "Customer    Offering    CompFee\nAcme Benefits    Dental    80.00",
      lines: ["Customer    Offering    CompFee", "Acme Benefits    Dental    80.00"],
    }];
    expect(candidateRowsFromPdfPages(pages, []).rowCount).toBe(0);
    expect(inferPdfStatementStructure(pages, [])?.preview.rowCount).toBe(1);

    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([500, 400]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText("Choice Builder commission statement narrative with enough words and letters to count as readable text without a table of groups premiums or commissions.", {
      x: 36,
      y: 300,
      size: 12,
      font,
      maxWidth: 420,
    });
    const narrative = new Uint8Array(await pdf.save());
    const failed = await inspectStatementUpload({
      fileName: "narrative.pdf",
      mimeType: "application/pdf",
      size: narrative.byteLength,
      buffer: narrative,
    });
    expect(failed.body.status).toBe("needs_layout");
    expect(pdfIntakeSurface({
      status: "needs_layout",
      sourceType: "pdf",
      hasReadableRows: false,
      pdfClassification: "needs_layout",
    })).toMatchObject({ kind: "structure_fallback", showMapping: false, showHelpAction: true });
  });

  it("5-8 scanned PDFs stay unsupported, known carrier is not mapped, and Agent/split are absent", async () => {
    const scanned = await inspectStatementUpload({
      fileName: "scan.pdf",
      mimeType: "application/pdf",
      size: 10,
      buffer: await imageOnlyPdf(),
    });
    expect(scanned.body.status).toBe("unreadable");
    expect(String(scanned.body.message)).toMatch(/scanned or image-based|automatic reading is not supported/i);
    expect(pdfIntakeSurface({
      status: "unreadable",
      sourceType: "pdf",
      hasReadableRows: false,
      pdfClassification: "unreadable",
    }).kind).toBe("scanned_unsupported");

    const mapping = omitStatementCompensationMapping(suggestColumnMapping(["Member", "Plan", "Paid", "Fee", "Agent", "Split"]));
    expect(mapping.agent).toBeUndefined();
    expect(mapping.compensationPercent).toBeUndefined();
    expect(mappingFields).not.toContain("agent");
    expect(Object.values(mappingFieldLabels)).not.toContain("Agent");
    expect(Object.values(mappingFieldLabels)).not.toContain("Agent split %");
    expect(pdfIntakeSurface({
      hasReadableRows: true,
      statementCarrierName: "Choice Builder",
    }).showCarrierMapping).toBe(false);
  });

  it("9-12 learned carrier LOB resolves, unknown LOB waits, CSV stays intact, and inspect never posts", async () => {
    const db = await createTestDb();
    const anthem = await createCarrier(db, { name: "Anthem" });
    const vision = await createLineOfBusiness(db, { name: "Group Vision" });
    await createGroup(db, { name: "Acme Benefits", groupNumber: "A1" });
    await rememberCarrierCoverageAlias(db, {
      carrierId: anthem.id,
      sourceValue: "VIS",
      lineOfBusinessId: vision.id,
    });
    const csv = [
      "Group Name,Group Number,LOB,Premium,Commission",
      "Acme Benefits,A1,VIS,1000.00,80.00",
    ].join("\n");
    const buffer = new TextEncoder().encode(csv);
    const preview = previewCsv(buffer, await listGroups(db));
    const statement = await createImportStatement(db, {
      originalFilename: "anthem.csv",
      paidMonth: "2026-08",
      carrierId: anthem.id,
      sourceType: "csv",
      status: "ready_to_map",
      fingerprint: fingerprintBuffer(buffer),
      preview,
    });
    const learned = await previewImportPosting(db, statement.id, suggestColumnMapping(preview.sheets[0]!.headers));
    expect(learned.unmatchedLines).toHaveLength(0);
    expect(learned.rows[0]?.lineOfBusinessId).toBe(vision.id);

    const unknownCsv = new TextEncoder().encode([
      "Group Name,Group Number,LOB,Premium,Commission",
      "Acme Benefits,A1,XYZCODE,1000.00,80.00",
    ].join("\n"));
    const unknownPreview = previewCsv(unknownCsv, await listGroups(db));
    const unknownStatement = await createImportStatement(db, {
      originalFilename: "unknown-lob.csv",
      paidMonth: "2026-08",
      carrierId: anthem.id,
      sourceType: "csv",
      status: "ready_to_map",
      fingerprint: fingerprintBuffer(unknownCsv),
      preview: unknownPreview,
    });
    const unknown = await previewImportPosting(db, unknownStatement.id, suggestColumnMapping(unknownPreview.sheets[0]!.headers));
    expect(unknown.unmatchedLines[0]?.sourceName).toBe("XYZCODE");
    expect(unknown.rows[0]?.status).toBe("blocked");
    expect(unknown.rows[0]?.exceptions.join(" ")).toMatch(/line of business|unmatched/i);

    const csvInspect = await inspectStatementUpload({
      fileName: "existing.csv",
      mimeType: "text/csv",
      size: buffer.byteLength,
      buffer,
    });
    expect(csvInspect.body.fileType).toBe("csv");
    expect(csvInspect.body.status).toBe("ready_to_map");
    expect((csvInspect.body.preview as { rowCount?: number }).rowCount).toBeGreaterThan(0);

    const pdf = await textCommissionPdf();
    await inspectStatementUpload({
      fileName: "readable.pdf",
      mimeType: "application/pdf",
      size: pdf.byteLength,
      buffer: pdf,
      paidMonth: "2026-08",
      carrierId: String(anthem.id),
      persist: true,
    }, db);
    expect(await listCommissions(db)).toHaveLength(0);
  });
});
