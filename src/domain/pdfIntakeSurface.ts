import { canReviewRows, isUnparsedStatement } from "./statementWorkflow";
import { mappingFieldLabels, mappingFields, statementIntakeHiddenFields, type ColumnMapping } from "./columnMapping";

export type PdfIntakeKind =
  | "extracted_confirmation"
  | "partial_confirmation"
  | "structure_fallback"
  | "scanned_unsupported"
  | "extraction_error";

export type PdfIntakeSurface = {
  kind: PdfIntakeKind;
  showMapping: boolean;
  showAgent: boolean;
  showAgentSplit: boolean;
  showCarrierMapping: boolean;
  showHelpAction: boolean;
  confirmationTitle: string | null;
};

export function pdfIntakeSurface(input: {
  status?: string | null;
  sourceType?: string | null;
  hasReadableRows?: boolean;
  readyCount?: number;
  blockedCount?: number;
  statementCarrierName?: string | null;
  pdfClassification?: string | null;
}): PdfIntakeSurface {
  const hidden = {
    showAgent: false,
    showAgentSplit: false,
    showCarrierMapping: Boolean(input.statementCarrierName) ? false : input.hasReadableRows === true,
  };
  if (input.status === "unreadable" || input.pdfClassification === "unreadable") {
    return {
      kind: "scanned_unsupported",
      showMapping: false,
      showHelpAction: false,
      confirmationTitle: null,
      ...hidden,
      showCarrierMapping: false,
    };
  }
  if (input.status === "extraction_failed" || input.pdfClassification === "failed") {
    return {
      kind: "extraction_error",
      showMapping: false,
      showHelpAction: false,
      confirmationTitle: null,
      ...hidden,
      showCarrierMapping: false,
    };
  }
  if (input.hasReadableRows) {
    const blocked = input.blockedCount ?? 0;
    const kind = blocked > 0 && (input.readyCount ?? 0) > 0 ? "partial_confirmation" : "extracted_confirmation";
    return {
      kind,
      showMapping: false,
      showHelpAction: true,
      confirmationTitle: "We found extracted commission records.",
      ...hidden,
    };
  }
  return {
    kind: "structure_fallback",
    showMapping: false,
    showHelpAction: true,
    confirmationTitle: null,
    ...hidden,
    showCarrierMapping: false,
  };
}

export function statementIntakeMappingLabels() {
  return mappingFields.map((field) => mappingFieldLabels[field]);
}

export function statementIntakeHidesCompensationFields(mapping: ColumnMapping) {
  return statementIntakeHiddenFields.every((field) => {
    if (field === "compensationPercent") return mapping.compensationPercent == null;
    return field === "agent";
  }) && !statementIntakeMappingLabels().includes("Agent") && !statementIntakeMappingLabels().includes("Agent split %");
}

export function pdfShouldUseExtractedConfirmation(statement: {
  status?: string | null;
  sourceType?: string | null;
  preview?: { sheets?: Array<{ rows?: unknown[] }>; pdf?: { classification?: string | null } | null } | null;
}) {
  if (statement.sourceType !== "pdf") return false;
  if (isUnparsedStatement(statement, canReviewRows(statement.preview))) return false;
  return canReviewRows(statement.preview);
}
