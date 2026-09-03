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

export async function imageOnlyPdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([300, 300]);
  const image = await pdf.embedPng(tinyPng);
  page.drawImage(image, { x: 80, y: 80, width: 140, height: 140 });
  return new Uint8Array(await pdf.save());
}
