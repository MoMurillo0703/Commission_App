export type StatementFileKind = "csv" | "excel" | "xls" | "pdf";

export function classifyStatementFile(fileName: string, mimeType = ""): StatementFileKind | null {
  if (/\.csv$/i.test(fileName) || mimeType === "text/csv" || mimeType === "application/csv") return "csv";
  if (/\.pdf$/i.test(fileName) || mimeType === "application/pdf") return "pdf";
  if (/\.xlsx$/i.test(fileName) || mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "excel";
  if (/\.xls$/i.test(fileName) || mimeType === "application/vnd.ms-excel") return "xls";
  return null;
}

export function statementFilesFromList(files: Array<{ name: string; type?: string }>) {
  return files.map((file) => ({
    name: file.name,
    kind: classifyStatementFile(file.name, file.type ?? ""),
  }));
}
