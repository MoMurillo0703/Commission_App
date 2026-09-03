export type BulkGroupAssignment = {
  groupIds: number[];
  accountManagerId?: number | null;
  primaryAgentId?: number | null;
};

export function normalizeBulkGroupAssignment(input: BulkGroupAssignment) {
  const groupIds = [...new Set(input.groupIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (groupIds.length === 0) throw new Error("Select at least one group.");
  const hasManager = Object.prototype.hasOwnProperty.call(input, "accountManagerId");
  const hasAgent = Object.prototype.hasOwnProperty.call(input, "primaryAgentId");
  if (!hasManager && !hasAgent) {
    throw new Error("Choose an account manager, a primary agent, or both.");
  }
  return {
    groupIds,
    hasManager,
    hasAgent,
    accountManagerId: hasManager ? input.accountManagerId ?? null : undefined,
    primaryAgentId: hasAgent ? input.primaryAgentId ?? null : undefined,
  };
}

export function bulkAssignmentSummary(input: ReturnType<typeof normalizeBulkGroupAssignment>, names: {
  accountManagerName?: string | null;
  primaryAgentName?: string | null;
}) {
  const parts = [`${input.groupIds.length} group${input.groupIds.length === 1 ? "" : "s"} selected`];
  if (input.hasManager) parts.push(`Account Manager: ${names.accountManagerName || "Unassigned"}`);
  if (input.hasAgent) parts.push(`Primary Agent: ${names.primaryAgentName || "Unassigned"}`);
  return parts.join(" · ");
}
