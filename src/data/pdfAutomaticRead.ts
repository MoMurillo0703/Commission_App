import { listGroups } from "./groups";
import { loadStatementExtractionPages } from "./pdfLayoutConfirm";
import { saveConfirmedPdfPreview, saveImportColumnMapping, type ImportStatementView } from "./statements";
import type { AppDatabase } from "@/db";
import { omitStatementCompensationMapping } from "@/domain/columnMapping";
import { interpretExtractedPdfPages } from "@/domain/pdfStructureInference";
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
    const interpreted = interpretExtractedPdfPages(pages, await listGroups(db));
    if (!interpreted || interpreted.preview.rowCount === 0) return statement;
    await saveConfirmedPdfPreview(db, statement.id, interpreted.preview);
    return saveImportColumnMapping(db, statement.id, omitStatementCompensationMapping(interpreted.mapping));
  } catch {
    return statement;
  }
}
