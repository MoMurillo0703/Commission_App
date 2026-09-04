import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { murilloTheme } from "@/theme/tokens";
import type { ReportDocument } from "./reportDocuments";

const PAGE_WIDTH = 792;
const PAGE_HEIGHT = 612;
const MARGIN = 36;
const NAVY = hex(murilloTheme.navy);
const MUTED = hex(murilloTheme.textMuted);
const TEXT = hex(murilloTheme.text);
const LINE = hex(murilloTheme.border);
const NEG = hex(murilloTheme.errorText);
const ACCENT = hex(murilloTheme.accentText);

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

function isNumeric(header: string) {
  return /premium|gross|compensation|agency net|applicable %|team %|earned|payable|amount|id/i.test(header);
}

function isNegative(value: string) {
  return /^-\$|^-\d|\(\$/.test(value.trim());
}

export async function reportDocumentPdf(document: ReportDocument) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages: PDFPage[] = [];

  function addPage() {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    return page;
  }

  let page = addPage();
  let y = PAGE_HEIGHT - MARGIN;

  function ensure(height: number) {
    if (y - height >= 48) return;
    page = addPage();
    y = PAGE_HEIGHT - MARGIN;
    drawTableHeader();
  }

  function text(value: string, x: number, size: number, font: PDFFont, color = TEXT) {
    page.drawText(value, { x, y: y - size, size, font, color });
  }

  const innerWidth = PAGE_WIDTH - MARGIN * 2;
  text(document.agencyName.toUpperCase(), MARGIN, 9, bold, ACCENT);
  y -= 16;
  text(document.title, MARGIN, 18, bold, NAVY);
  y -= 22;
  text(`${document.period}  ·  Generated ${new Date(document.generatedAt).toLocaleString("en-US")}`, MARGIN, 10, regular, MUTED);
  y -= 16;
  for (const line of document.filtersUsed) {
    for (const wrapped of wrap(line, regular, 9, innerWidth)) {
      text(wrapped, MARGIN, 9, regular, MUTED);
      y -= 12;
    }
  }
  y -= 6;
  for (const note of document.notes ?? []) {
    for (const wrapped of wrap(note, regular, 9, innerWidth)) {
      text(wrapped, MARGIN, 9, regular, MUTED);
      y -= 12;
    }
  }
  y -= 8;

  const totals = document.totals;
  const boxWidth = totals.length ? Math.min(180, innerWidth / Math.max(totals.length, 1) - 8) : 0;
  totals.forEach((total, index) => {
    const x = MARGIN + index * (boxWidth + 8);
    page.drawRectangle({ x, y: y - 36, width: boxWidth, height: 40, borderColor: LINE, borderWidth: 1 });
    page.drawText(total.label, { x: x + 8, y: y - 14, size: 8, font: regular, color: MUTED });
    page.drawText(total.value, { x: x + 8, y: y - 30, size: 12, font: bold, color: NAVY });
  });
  if (totals.length) y -= 52;

  const columnCount = Math.max(document.headers.length, 1);
  const columnWidth = innerWidth / columnCount;

  function drawTableHeader() {
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1.5, color: NAVY });
    y -= 14;
    document.headers.forEach((header, index) => {
      const x = MARGIN + index * columnWidth;
      page.drawText(header, {
        x: isNumeric(header) ? x + columnWidth - bold.widthOfTextAtSize(header, 8) : x,
        y,
        size: 8,
        font: bold,
        color: MUTED,
      });
    });
    y -= 6;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.6, color: LINE });
    y -= 12;
  }

  drawTableHeader();
  for (const row of document.rows) {
    const wrappedCells = row.map((cell, index) => wrap(cell, regular, 8, columnWidth - 4));
    const rowHeight = Math.max(12, ...wrappedCells.map((lines) => lines.length * 10));
    ensure(rowHeight + 4);
    row.forEach((cell, index) => {
      const lines = wrappedCells[index] ?? [cell];
      const x = MARGIN + index * columnWidth;
      const numeric = isNumeric(document.headers[index] ?? "");
      const color = numeric && isNegative(cell) ? NEG : TEXT;
      lines.forEach((line, lineIndex) => {
        page.drawText(line, {
          x: numeric ? x + columnWidth - regular.widthOfTextAtSize(line, 8) : x,
          y: y - lineIndex * 10,
          size: 8,
          font: regular,
          color,
        });
      });
    });
    y -= rowHeight;
  }

  const totalPages = pages.length;
  pages.forEach((footerPage, index) => {
    footerPage.drawLine({
      start: { x: MARGIN, y: 28 },
      end: { x: PAGE_WIDTH - MARGIN, y: 28 },
      thickness: 0.6,
      color: LINE,
    });
    footerPage.drawText(
      `Confidential · ${document.agencyName} · Posted commissions only · Page ${index + 1} of ${totalPages}`,
      { x: MARGIN, y: 16, size: 8, font: regular, color: MUTED },
    );
  });

  return await pdf.save();
}
