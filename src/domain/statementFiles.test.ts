import { describe, expect, it } from "vitest";
import { classifyStatementFile, statementFilesFromList } from "./statementFiles";

describe("statement file intake", () => {
  it("accepts drag-and-drop and multi-file selections as individual files", () => {
    const files = statementFilesFromList([
      { name: "Anthem - 08 2026.csv", type: "text/csv" },
      { name: "principal.xlsx" },
      { name: "legacy.xls" },
      { name: "scan.pdf" },
    ]);
    expect(files.map((file) => file.kind)).toEqual(["csv", "excel", "xls", "pdf"]);
    expect(files).toHaveLength(4);
    const pdfMagic = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x34]);
    expect(classifyStatementFile("statement", "application/octet-stream", pdfMagic)).toBe("pdf");
  });

  it("rejects unsupported formats instead of skipping them", () => {
    expect(classifyStatementFile("notes.txt")).toBeNull();
    expect(classifyStatementFile("image.png", "image/png")).toBeNull();
  });
});
