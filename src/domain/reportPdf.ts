import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { murilloTheme } from "@/theme/tokens";
import { isNegativeReportCell, isNumericReportHeader, type ReportDocument, type ReportDocumentSection } from "./reportDocuments";

const NAVY = hex(murilloTheme.navy);
const MUTED = hex(murilloTheme.textMuted);
const TEXT = hex(murilloTheme.text);
const LINE = hex(murilloTheme.border);
const NEG = hex(murilloTheme.errorText);
const ACCENT = hex(murilloTheme.accentText);
const ALT = hex(murilloTheme.rowAlt);

function hex(value: string) {
  const cleaned = value.replace("#", "");
  return rgb(
    Number.parseInt(cleaned.slice(0, 2), 16) / 255,
    Number.parseInt(cleaned.slice(2, 4), 16) / 255,
    Number.parseInt(cleaned.slice(4, 6), 16) / 255,
  );
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function pageSize(document: ReportDocument) {
  if (document.layout === "statement") return { width: 612, height: 792 };
  return { width: 792, height: 612 };
}

function columnWidths(headers: string[], innerWidth: number) {
  const weights = headers.map((header) => {
    if (/%|comm|commission/i.test(header)) return 1.15;
    if (isNumericReportHeader(header)) return 0.95;
    if (/carrier|client|group/i.test(header)) return 1.45;
    return 1;
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => (innerWidth * weight) / total);
}

export async function reportDocumentPdf(document: ReportDocument) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width: PAGE_WIDTH, height: PAGE_HEIGHT } = pageSize(document);
  const MARGIN = 40;
  const pages: PDFPage[] = [];
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  pages.push(page);
  let y = PAGE_HEIGHT - MARGIN;
  const innerWidth = PAGE_WIDTH - MARGIN * 2;

  function addPage() {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    y = PAGE_HEIGHT - MARGIN;
  }

  function ensure(height: number) {
    if (y - height >= 48) return;
    addPage();
  }

  function text(value: string, x: number, size: number, font: PDFFont, color = TEXT) {
    page.drawText(value, { x, y: y - size, size, font, color });
  }

  function drawHeader() {
    text(document.agencyName.toUpperCase(), MARGIN, 8, bold, ACCENT);
    y -= 14;
    text(document.heading ?? document.title, MARGIN, 18, bold, NAVY);
    y -= 22;
    if (document.subheading && document.subheading !== document.heading) {
      text(document.subheading, MARGIN, 11, regular, TEXT);
      y -= 14;
    }
    text(`Generated ${new Date(document.generatedAt).toLocaleString("en-US")}`, MARGIN, 9, regular, MUTED);
    y -= 16;
    for (const line of document.filtersUsed.slice(0, 4)) {
      for (const wrapped of wrap(line, regular, 8, innerWidth)) {
        text(wrapped, MARGIN, 8, regular, MUTED);
        y -= 11;
      }
    }
    y -= 4;
    for (const note of document.notes ?? []) {
      for (const wrapped of wrap(note, regular, 8, innerWidth)) {
        text(wrapped, MARGIN, 8, regular, MUTED);
        y -= 11;
      }
    }
    y -= 8;
    const totals = document.totals;
    if (totals.length) {
      const boxWidth = Math.min(128, innerWidth / totals.length - 6);
      totals.forEach((total, index) => {
        const x = MARGIN + index * (boxWidth + 6);
        page.drawRectangle({ x, y: y - 38, width: boxWidth, height: 40, borderColor: LINE, borderWidth: 0.8, color: ALT });
        page.drawText(total.label, { x: x + 6, y: y - 14, size: 7, font: regular, color: MUTED });
        page.drawText(total.value, { x: x + 6, y: y - 30, size: 11, font: bold, color: NAVY });
      });
      y -= 52;
    }
  }

  function drawSectionTable(section: ReportDocumentSection) {
    const widths = columnWidths(section.headers, innerWidth);
    ensure(56);
    text(section.title, MARGIN, 12, bold, NAVY);
    y -= 16;
    if (section.subtitle) {
      text(section.subtitle, MARGIN, 8, regular, MUTED);
      y -= 12;
    }
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1.2, color: NAVY });
    y -= 12;
    let x = MARGIN;
    section.headers.forEach((header, index) => {
      const numeric = isNumericReportHeader(header);
      const label = header;
      page.drawText(label, {
        x: numeric ? x + widths[index]! - bold.widthOfTextAtSize(label, 7) : x,
        y,
        size: 7,
        font: bold,
        color: MUTED,
      });
      x += widths[index]!;
    });
    y -= 8;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.5, color: LINE });
    y -= 10;

    const allRows = [
      ...section.rows.map((row) => ({ row, total: false })),
      ...(section.totals ?? []).map((total) => ({ row: total.cells, total: true })),
    ];
    for (const { row, total } of allRows) {
      const wrapped = row.map((cell, index) => wrap(cell, total ? bold : regular, 8, widths[index]! - 4));
      const rowHeight = Math.max(11, ...wrapped.map((lines) => lines.length * 10));
      ensure(rowHeight + 6);
      if (total) {
        page.drawLine({ start: { x: MARGIN, y: y + 10 }, end: { x: PAGE_WIDTH - MARGIN, y: y + 10 }, thickness: 0.7, color: NAVY });
      }
      let cellX = MARGIN;
      row.forEach((cell, index) => {
        const numeric = isNumericReportHeader(section.headers[index] ?? "");
        const color = numeric && isNegativeReportCell(cell) ? NEG : TEXT;
        const font = total ? bold : regular;
        const lines = wrapped[index] ?? [cell];
        lines.forEach((line, lineIndex) => {
          page.drawText(line, {
            x: numeric ? cellX + widths[index]! - font.widthOfTextAtSize(line, 8) : cellX,
            y: y - lineIndex * 10,
            size: 8,
            font,
            color,
          });
        });
        cellX += widths[index]!;
      });
      y -= rowHeight + 2;
    }
    y -= 10;
  }

  drawHeader();

  if (document.layout === "statement" && ((document.summaryTables?.length ?? 0) + (document.groupSections?.length ?? 0)) > 0) {
    for (const section of document.summaryTables ?? []) drawSectionTable(section);
    for (const section of document.groupSections ?? []) drawSectionTable(section);
    if (document.footerTotals?.length) {
      ensure(64);
      page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1.4, color: NAVY });
      y -= 16;
      text("Grand Total", MARGIN, 12, bold, NAVY);
      y -= 18;
      for (const total of document.footerTotals) {
        page.drawText(total.label, { x: MARGIN, y, size: 9, font: regular, color: MUTED });
        page.drawText(total.value, {
          x: PAGE_WIDTH - MARGIN - bold.widthOfTextAtSize(total.value, 11),
          y,
          size: 11,
          font: bold,
          color: isNegativeReportCell(total.value) ? NEG : NAVY,
        });
        y -= 14;
      }
    }
  } else {
    const widths = columnWidths(document.headers, innerWidth);
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1.2, color: NAVY });
    y -= 12;
    let headerX = MARGIN;
    document.headers.forEach((header, index) => {
      const numeric = isNumericReportHeader(header);
      page.drawText(header, {
        x: numeric ? headerX + widths[index]! - bold.widthOfTextAtSize(header, 7) : headerX,
        y,
        size: 7,
        font: bold,
        color: MUTED,
      });
      headerX += widths[index]!;
    });
    y -= 10;
    for (const row of document.rows) {
      const wrapped = row.map((cell, index) => wrap(cell, regular, 8, widths[index]! - 4));
      const rowHeight = Math.max(11, ...wrapped.map((lines) => lines.length * 10));
      ensure(rowHeight + 4);
      let cellX = MARGIN;
      row.forEach((cell, index) => {
        const numeric = isNumericReportHeader(document.headers[index] ?? "");
        const color = numeric && isNegativeReportCell(cell) ? NEG : TEXT;
        (wrapped[index] ?? [cell]).forEach((line, lineIndex) => {
          page.drawText(line, {
            x: numeric ? cellX + widths[index]! - regular.widthOfTextAtSize(line, 8) : cellX,
            y: y - lineIndex * 10,
            size: 8,
            font: regular,
            color,
          });
        });
        cellX += widths[index]!;
      });
      y -= rowHeight + 2;
    }
  }

  pages.forEach((footerPage, index) => {
    footerPage.drawLine({
      start: { x: MARGIN, y: 28 },
      end: { x: PAGE_WIDTH - MARGIN, y: 28 },
      thickness: 0.5,
      color: LINE,
    });
    footerPage.drawText(
      `Confidential · ${document.agencyName} · Posted snapshots only · Page ${index + 1} of ${pages.length}`,
      { x: MARGIN, y: 16, size: 8, font: regular, color: MUTED },
    );
  });

  return await pdf.save();
}
