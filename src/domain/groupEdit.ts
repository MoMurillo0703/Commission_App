export type GroupEditDraft = {
  id: number;
  name: string;
  groupNumber: string;
  accountManagerId: string;
  primaryAgentId: string;
  notes: string;
};

export function groupEditDraftFrom(row: {
  id: number;
  name: string;
  groupNumber?: string | null;
  accountManagerId?: number | null;
  primaryAgentId?: number | null;
  notes?: string | null;
}): GroupEditDraft {
  return {
    id: row.id,
    name: row.name,
    groupNumber: row.groupNumber ?? "",
    accountManagerId: row.accountManagerId == null ? "" : String(row.accountManagerId),
    primaryAgentId: row.primaryAgentId == null ? "" : String(row.primaryAgentId),
    notes: row.notes ?? "",
  };
}

export function groupEditTitle(name: string) {
  return `Editing: ${name}`;
}
