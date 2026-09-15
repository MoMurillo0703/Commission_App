import { paidMonthPattern } from "./dates";
import { parsePercentToBps } from "./money";
import { peopleSplitIsComplete } from "./personCompensationModel";

export type BulkCompensationEditorPerson = {
  personKind: "agent" | "account_manager";
  personId: string;
  percent: string;
};

export type BulkCompensationEditorTarget = {
  groupId: number;
  lineOfBusinessId: number;
};

export type BulkCompensationEditorState = {
  effectiveStart: string;
  mode: "template" | "custom";
  teamId: string;
  people: BulkCompensationEditorPerson[];
  targets: BulkCompensationEditorTarget[];
};

export type BulkCompensationEditorRequest = {
  effectiveStart: string;
  mode: "template" | "custom";
  teamId: number | null;
  people?: Array<{
    personKind: "agent" | "account_manager";
    personId: number;
    compensationPercent: string;
  }>;
  targets: BulkCompensationEditorTarget[];
};

export function directorySelectionAfterReload(input: {
  editorOpen: boolean;
  selectedKeys: string[];
  nextKeys: string[];
}) {
  if (input.editorOpen) return input.selectedKeys;
  return input.selectedKeys.filter((key) => input.nextKeys.includes(key));
}

export function buildBulkCompensationRequestBody(state: BulkCompensationEditorState): BulkCompensationEditorRequest {
  const teamId = Number(state.teamId);
  return {
    effectiveStart: state.effectiveStart,
    mode: state.mode,
    teamId: state.mode === "template" && Number.isInteger(teamId) && teamId > 0 ? teamId : null,
    people: state.mode === "custom"
      ? state.people.map((row) => ({
        personKind: row.personKind,
        personId: Number(row.personId),
        compensationPercent: row.percent,
      }))
      : undefined,
    targets: state.targets,
  };
}

export function bulkCompensationPreviewBlockReason(state: BulkCompensationEditorState) {
  if (!paidMonthPattern.test(state.effectiveStart)) {
    return "Enter an effective start month as YYYY-MM.";
  }
  if (state.targets.length === 0) {
    return "Select at least one Group and Line of Coverage.";
  }
  if (state.mode === "template") {
    const teamId = Number(state.teamId);
    if (!Number.isInteger(teamId) || teamId < 1) return "Choose a compensation template.";
    return null;
  }
  if (state.people.some((row) => !Number.isInteger(Number(row.personId)) || Number(row.personId) < 1)) {
    return "Select each person in the split.";
  }
  try {
    const people = state.people.map((row) => ({ compensationBps: parsePercentToBps(row.percent) }));
    if (!peopleSplitIsComplete(people)) return "Compensation split must total 100%.";
  } catch (error) {
    return error instanceof Error ? error.message : "Compensation split must total 100%.";
  }
  return null;
}

export function bulkCompensationCommitReady(preview: { previewToken?: string | null; hasConflicts: boolean } | null, previewedRequest: BulkCompensationEditorRequest | null) {
  return Boolean(
    preview
    && previewedRequest
    && preview.previewToken
    && preview.previewToken.length >= 16
    && !preview.hasConflicts
    && previewedRequest.targets.length > 0,
  );
}

export function bulkCompensationCommitBody(
  previewedRequest: BulkCompensationEditorRequest,
  previewToken: string,
) {
  return {
    ...previewedRequest,
    previewToken,
  };
}
