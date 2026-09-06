export function groupHasSavedAssignments(group: {
  accountManagerId?: number | null;
  primaryAgentId?: number | null;
}) {
  return Boolean(group.accountManagerId && group.primaryAgentId);
}

export function partitionStatementGroupAssignments<T extends {
  accountManagerId?: number | null;
  primaryAgentId?: number | null;
}>(groups: T[]) {
  return {
    assigned: groups.filter((group) => groupHasSavedAssignments(group)),
    needsAssignment: groups.filter((group) => !groupHasSavedAssignments(group)),
  };
}
