import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export async function textCommissionPdf(pages = 1) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const headers = ["Group Name", "Group Number", "LOB", "Agent", "Premium", "Commission", "Coverage Month"];
  const xs = [36, 150, 250, 310, 420, 500, 600];
  for (let index = 0; index < pages; index += 1) {
    const page = pdf.addPage([720, 500]);
    const values = index === 0
      ? ["Acme Benefits", "A1", "Dental", "Alex Morgan", "1000.00", "80.00", "2026-07"]
      : ["Gamma Group", "G3", "Dental", "Alex Morgan", "250.00", "20.00", "2026-08"];
    page.drawText("SANITIZED CARRIER COMMISSION STATEMENT", { x: 36, y: 440, size: 12, font, color: rgb(0, 0, 0) });
    page.drawText(`Page ${index + 1}`, { x: 36, y: 418, size: 10, font });
    headers.forEach((header, column) => page.drawText(header, { x: xs[column]!, y: 380, size: 9, font }));
    values.forEach((value, column) => page.drawText(value, { x: xs[column]!, y: 360, size: 9, font }));
    page.drawText("Subtotal    100.00", { x: 36, y: 330, size: 9, font });
    page.drawText("Total    100.00", { x: 36, y: 312, size: 9, font });
    page.drawText(`Page ${index + 1} of ${pages}`, { x: 36, y: 294, size: 9, font });
  }
  return new Uint8Array(await pdf.save());
}

export async function readableHiddenTablePdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([720, 500]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("Choice Builder commission statement for the paid month with readable embedded text.", {
    x: 36,
    y: 440,
    size: 11,
    font,
    color: rgb(0, 0, 0),
    maxWidth: 640,
  });
  const headers = ["Member", "Plan", "Paid", "Fee"];
  const first = ["Acme Benefits", "Dental", "1000.00", "80.00"];
  const second = ["Gamma Group", "Dental", "250.00", "20.00"];
  const xs = [36, 220, 360, 480];
  headers.forEach((header, column) => page.drawText(header, { x: xs[column]!, y: 380, size: 9, font }));
  first.forEach((value, column) => page.drawText(value, { x: xs[column]!, y: 360, size: 9, font }));
  headers.forEach((header, column) => page.drawText(header, { x: xs[column]!, y: 340, size: 9, font }));
  second.forEach((value, column) => page.drawText(value, { x: xs[column]!, y: 320, size: 9, font }));
  page.drawText("Subtotal    100.00", { x: 36, y: 292, size: 9, font });
  page.drawText("Total    100.00", { x: 36, y: 274, size: 9, font });
  page.drawText("Page 1 of 1", { x: 36, y: 256, size: 9, font });
  return new Uint8Array(await pdf.save());
}

export const choiceBuilderStatementLines = [
  "COMMISSION STATEMENT",
  "Choice Builder",
  "COMMISSIONS FOR AGENCY MURILLO INSURANCE",
  "Broker Name    Comm",
  "Amount",
  "ALEX MORGAN    $340.68",
  "TOTAL PAID COMMISSIONS    $340.68",
  "COMMISSIONS FOR BROKER ALEX MORGAN",
  "Company Name    Paid Month    Product    Comm Amount    ADJ CD",
  "Policy Number: B05095",
  "ACME PET RESORT    Aug 2026    Dental    $14.88",
  "Aug 2026    Vision    $7.47",
  "Sep 2026    Dental    $14.88",
  "Sep 2026    Vision    $7.47",
  "Policy Number: B16568",
  "SMITH FARMS    Aug 2026    Dental    $22.00",
  "Aug 2026    Vision    $5.00",
  "TOTAL COMMISSIONS: ALEX MORGAN",
  "Total Dental Commissions    $36.88",
  "Total Vision Commissions    $12.47",
  "Page 1 of 1",
];

export async function choiceBuilderStatementPdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([720, 720]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let y = 680;
  for (const line of choiceBuilderStatementLines) {
    page.drawText(line, { x: 36, y, size: 9, font, color: rgb(0, 0, 0), maxWidth: 650 });
    y -= 16;
  }
  return new Uint8Array(await pdf.save());
}

export async function unrecognizedHeaderTablePdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([720, 420]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText("Readable commission statement with unrecognized column titles.", {
    x: 36,
    y: 380,
    size: 11,
    font,
    color: rgb(0, 0, 0),
    maxWidth: 640,
  });
  const headers = ["Customer", "Offering", "CompFee"];
  const first = ["Acme Benefits", "Dental", "80.00"];
  const second = ["Smith Farms", "Vision", "62.00"];
  const xs = [36, 240, 420];
  headers.forEach((header, column) => page.drawText(header, { x: xs[column]!, y: 330, size: 9, font }));
  first.forEach((value, column) => page.drawText(value, { x: xs[column]!, y: 310, size: 9, font }));
  second.forEach((value, column) => page.drawText(value, { x: xs[column]!, y: 290, size: 9, font }));
  return new Uint8Array(await pdf.save());
}

export async function imageOnlyPdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([300, 300]);
  const image = await pdf.embedPng(tinyPng);
  page.drawImage(image, { x: 80, y: 80, width: 140, height: 140 });
  return new Uint8Array(await pdf.save());
}
