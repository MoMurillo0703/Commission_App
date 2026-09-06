import { listCarrierGroupIdentities } from "./carrierGroupIdentities";
import { listGroups } from "./groups";
import { loadStatementExtractionPages } from "./pdfLayoutConfirm";
import { saveConfirmedPdfPreview, saveImportColumnMapping, type ImportStatementView } from "./statements";
import type { AppDatabase } from "@/db";
import { omitStatementCompensationMapping } from "@/domain/columnMapping";
import { looksLikeCaliforniaChoice } from "@/domain/californiaChoice";
import { interpretExtractedPdfPages } from "@/domain/pdfStructureInference";
import { canReviewRows } from "@/domain/statementWorkflow";

function californiaChoiceSourceHint(statement: ImportStatementView) {
  return [statement.originalFilename, statement.carrierName].filter(Boolean).join("\n");
}

export async function recoverAutomaticPdfRead(
  db: AppDatabase | undefined,
  statement: ImportStatementView,
): Promise<ImportStatementView> {
  if (statement.sourceType !== "pdf") return statement;
  if (statement.status === "posted" || statement.status === "partially_posted") return statement;
  if (statement.status === "unreadable" || statement.status === "extraction_failed") return statement;
  try {
    const pages = await loadStatementExtractionPages(db, statement);
    const sourceHint = californiaChoiceSourceHint(statement);
    const misreadCaliforniaChoice = looksLikeCaliforniaChoice(pages, sourceHint)
      && statement.preview?.pdf?.groupMatchStrategy !== "carrier_group_identity";
    if (canReviewRows(statement.preview) && !misreadCaliforniaChoice) return statement;
    const interpreted = interpretExtractedPdfPages(pages, await listGroups(db), {
      carrierId: statement.carrierId,
      identities: await listCarrierGroupIdentities(db, statement.carrierId),
      sourceHint,
    });
    if (!interpreted || interpreted.preview.rowCount === 0) return statement;
    if (misreadCaliforniaChoice && interpreted.preview.pdf?.groupMatchStrategy !== "carrier_group_identity") {
      return statement;
    }
    await saveConfirmedPdfPreview(db, statement.id, {
      ...interpreted.preview,
      groupResolutions: statement.preview?.groupResolutions,
      lineResolutions: statement.preview?.lineResolutions,
      agentResolutions: statement.preview?.agentResolutions,
      pdf: {
        classification: "readable",
        pageCount: interpreted.preview.pdf?.pageCount ?? pages.length,
        ...interpreted.preview.pdf,
        extractionPath: statement.extractionPath ?? statement.preview?.pdf?.extractionPath ?? null,
      },
    });
    return saveImportColumnMapping(db, statement.id, omitStatementCompensationMapping(interpreted.mapping));
  } catch {
    return statement;
  }
}
