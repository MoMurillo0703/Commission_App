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
  });

  it("rejects unsupported formats instead of skipping them", () => {
    expect(classifyStatementFile("notes.txt")).toBeNull();
    expect(classifyStatementFile("image.png", "image/png")).toBeNull();
  });
});
