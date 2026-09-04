import { listGroups } from "./groups";
import { loadStatementExtractionPages } from "./pdfLayoutConfirm";
import { saveConfirmedPdfPreview, saveImportColumnMapping, type ImportStatementView } from "./statements";
import type { AppDatabase } from "@/db";
import { omitStatementCompensationMapping } from "@/domain/columnMapping";
import { inferPdfStatementStructure } from "@/domain/pdfStructureInference";
import { canReviewRows } from "@/domain/statementWorkflow";

export async function recoverAutomaticPdfRead(
  db: AppDatabase | undefined,
  statement: ImportStatementView,
): Promise<ImportStatementView> {
  if (statement.sourceType !== "pdf") return statement;
  if (statement.status === "posted" || statement.status === "partially_posted") return statement;
  if (statement.status === "unreadable" || statement.status === "extraction_failed") return statement;
  if (canReviewRows(statement.preview)) return statement;
  try {
    const pages = await loadStatementExtractionPages(db, statement);
    const inferred = inferPdfStatementStructure(pages, await listGroups(db));
    if (!inferred || inferred.preview.rowCount === 0) return statement;
    await saveConfirmedPdfPreview(db, statement.id, inferred.preview);
    return saveImportColumnMapping(db, statement.id, omitStatementCompensationMapping(inferred.mapping));
  } catch {
    return statement;
  }
}
