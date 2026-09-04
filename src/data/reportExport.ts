import ExcelJS from "exceljs";
import { printableReportHtml, reportDocumentCsv, type ReportDocument } from "@/domain/reportDocuments";
import { reportDocumentPdf } from "@/domain/reportPdf";

export type ReportExportFormat = "csv" | "xlsx" | "pdf" | "print";

export async function exportReportDocument(document: ReportDocument, format: ReportExportFormat) {
  if (format === "csv") {
    return {
      filename: `${slug(document.title)}.csv`,
      contentType: "text/csv; charset=utf-8",
      body: reportDocumentCsv(document),
    };
  }
  if (format === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Report");
    sheet.addRow([document.agencyName]);
    sheet.addRow([document.title]);
    sheet.addRow([document.period]);
    sheet.addRow([`Generated ${document.generatedAt}`]);
    sheet.addRow([]);
    for (const line of document.filtersUsed) sheet.addRow([line]);
    for (const line of document.notes ?? []) sheet.addRow([line]);
    sheet.addRow([]);
    for (const total of document.totals) {
      const row = sheet.addRow([total.label, currencyNumber(total.value) ?? total.value]);
      if (typeof row.getCell(2).value === "number") row.getCell(2).numFmt = "$#,##0.00;[Red]-$#,##0.00";
    }
    sheet.addRow([]);
    sheet.addRow(document.headers);
    const moneyColumns = new Set(document.headers.flatMap((header, index) => (
      /premium|gross|compensation|agency net|payable|amount/i.test(header) && !/%/.test(header) ? [index] : []
    )));
    for (const values of document.rows) {
      const row = sheet.addRow(values.map((value, index) => moneyColumns.has(index) ? currencyNumber(value) ?? value : value));
      for (const index of moneyColumns) {
        if (typeof row.getCell(index + 1).value === "number") row.getCell(index + 1).numFmt = "$#,##0.00;[Red]-$#,##0.00";
      }
    }
    const buffer = await workbook.xlsx.writeBuffer();
    return {
      filename: `${slug(document.title)}.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: Buffer.from(buffer),
    };
  }
  if (format === "pdf") {
    return {
      filename: `${slug(document.title)}.pdf`,
      contentType: "application/pdf",
      body: Buffer.from(await reportDocumentPdf(document)),
    };
  }
  const html = printableReportHtml(document);
  return {
    filename: `${slug(document.title)}.html`,
    contentType: "text/html; charset=utf-8",
    body: html,
  };
}

function currencyNumber(value: string) {
  if (value === "—") return null;
  const normalized = value.replace(/[$,\s]/g, "");
  if (!/^-?\d+(?:\.\d{2})$/.test(normalized)) return null;
  return Number(normalized);
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "report";
}
