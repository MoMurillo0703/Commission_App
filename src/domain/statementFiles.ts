export type StatementFileKind = "csv" | "excel" | "xls" | "pdf";

export function hasPdfMagic(bytes?: ArrayBuffer | Uint8Array | null) {
  if (!bytes) return false;
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return view.length >= 4 && view[0] === 0x25 && view[1] === 0x50 && view[2] === 0x44 && view[3] === 0x46;
}

export function classifyStatementFile(
  fileName: string,
  mimeType = "",
  bytes?: ArrayBuffer | Uint8Array | null,
): StatementFileKind | null {
  if (hasPdfMagic(bytes) || /\.pdf$/i.test(fileName) || mimeType === "application/pdf") return "pdf";
  if (/\.csv$/i.test(fileName) || mimeType === "text/csv" || mimeType === "application/csv") return "csv";
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
