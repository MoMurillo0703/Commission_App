import { describe, expect, it } from "vitest";
import { inspectFailureMessage, SPREADSHEET_READ_ERROR } from "@/domain/statementInspect";
import { classifyStatementFile, hasPdfMagic } from "@/domain/statementFiles";
import { inspectStatementUpload } from "./inspectStatement";
import { createCarrier } from "./carriers";
import { createTestDb } from "@/db/test-db";
import { imageOnlyPdf, textCommissionPdf } from "../../tests/helpers/pdfFixtures";

function pdfHeader() {
  return new TextEncoder().encode("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n").buffer;
}

describe("statement inspect production path", () => {
  it("classifies PDFs by extension, MIME, or magic bytes", () => {
    expect(classifyStatementFile("choice-builder.pdf", "application/octet-stream")).toBe("pdf");
    expect(classifyStatementFile("statement", "application/pdf")).toBe("pdf");
    expect(hasPdfMagic(pdfHeader())).toBe(true);
    expect(classifyStatementFile("statement", "application/octet-stream", pdfHeader())).toBe("pdf");
    expect(inspectFailureMessage("pdf")).not.toBe(SPREADSHEET_READ_ERROR);
    expect(inspectFailureMessage("pdf")).toMatch(/PDF extraction failed/i);
  });

  it("sends a readable text PDF to the PDF extractor and never uses the CSV/XLSX error copy", async () => {
    const buffer = await textCommissionPdf();
    const result = await inspectStatementUpload({
      fileName: "Choice Builder.pdf",
      mimeType: "application/octet-stream",
      size: buffer.byteLength,
      buffer,
    });
    expect(result.status).toBe(200);
    expect(result.body.fileType).toBe("pdf");
    expect(String(result.body.message)).not.toMatch(/valid CSV or XLSX/i);
    expect(["ready_to_map", "needs_layout"]).toContain(result.body.status);
  });

  it("classifies a scanned PDF as unreadable without CSV/XLSX copy", async () => {
    const buffer = await imageOnlyPdf();
    const result = await inspectStatementUpload({
      fileName: "scan.pdf",
      mimeType: "application/pdf",
      size: buffer.byteLength,
      buffer,
    });
    expect(result.status).toBe(200);
    expect(result.body.status).toBe("unreadable");
    expect(String(result.body.message)).toMatch(/scanned or image-based|automatic reading is not supported/i);
    expect(String(result.body.message)).not.toMatch(/valid CSV or XLSX/i);
  });

  it("returns PDF extraction failed for a broken PDF and still can persist the original", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x34, 0x0a, 0x00, 0x01, 0x02]);
    const result = await inspectStatementUpload({
      fileName: "broken.pdf",
      mimeType: "application/pdf",
      size: bytes.byteLength,
      buffer: bytes,
    });
    expect(result.status).toBe(200);
    expect(result.body.status).toBe("extraction_failed");
    expect(String(result.body.message)).toMatch(/PDF extraction failed/i);
    expect(String(result.body.message)).not.toMatch(/valid CSV or XLSX/i);

    const db = await createTestDb();
    const carrier = await createCarrier(db, { name: "Choice Builder" });
    const persisted = await inspectStatementUpload({
      fileName: "broken.pdf",
      mimeType: "application/pdf",
      size: bytes.byteLength,
      buffer: bytes,
      paidMonth: "2026-09",
      carrierId: String(carrier.id),
      persist: true,
    }, db);
    expect(persisted.status).toBe(200);
    expect(persisted.body.status).toBe("extraction_failed");
    expect(String(persisted.body.message)).not.toMatch(/valid CSV or XLSX/i);
    expect((persisted.body.statement as { originalFilename?: string } | undefined)?.originalFilename).toBe("broken.pdf");
  });

  it("asks for layout confirmation when a text PDF has no candidate table", async () => {
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
    const buffer = new Uint8Array(await pdf.save());
    const result = await inspectStatementUpload({
      fileName: "narrative.pdf",
      mimeType: "application/pdf",
      size: buffer.byteLength,
      buffer,
    });
    expect(result.status).toBe(200);
    expect(result.body.fileType).toBe("pdf");
    expect(result.body.status).toBe("needs_layout");
    expect(result.body.status).not.toBe("needs_profile");
    expect(String(result.body.message)).toMatch(/table|layout|confirm/i);
    expect(String(result.body.message)).not.toMatch(/valid CSV or XLSX/i);
    expect(String(result.body.message)).not.toMatch(/extraction profile/i);
  });

  it("never returns the spreadsheet error when a classified PDF throws during inspect", async () => {
    const buffer = await textCommissionPdf();
    const result = await inspectStatementUpload({
      fileName: "readable-unknown.pdf",
      mimeType: "application/pdf",
      size: buffer.byteLength,
      buffer,
    });
    expect(String(result.body.message ?? "")).not.toBe(SPREADSHEET_READ_ERROR);
    expect(result.body.fileType).toBe("pdf");
  });
});
