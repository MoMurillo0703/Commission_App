export type AssignmentStatus = "assigned" | "unassigned" | "needs_review";

export interface CommissionRow {
  id: string;
  carrier: string;
  statementPeriod: string;
  groupName: string | null;
  groupNumber: string | null;
  lineOfBusiness: string | null;
  productName: string | null;
  premium: number | null;
  commission: number;
  agentName: string | null;
  assignmentStatus: AssignmentStatus;
}

export interface CommissionSummary {
  commissions: number;
  premium: number;
  groups: number;
  exceptions: number;
}

export function summarize(rows: CommissionRow[]): CommissionSummary {
  return {
    commissions: rows.reduce((sum, row) => sum + row.commission, 0),
    premium: rows.reduce((sum, row) => sum + (row.premium ?? 0), 0),
    groups: new Set(rows.map((row) => row.groupNumber ?? row.groupName).filter(Boolean)).size,
    exceptions: rows.filter((row) => row.assignmentStatus !== "assigned").length,
  };
}

export function summarizeByAgent(rows: CommissionRow[]) {
  const agents = new Map<string, CommissionSummary>();
  for (const row of rows) {
    const key = row.agentName ?? "Unassigned";
    const existing = agents.get(key) ?? { commissions: 0, premium: 0, groups: 0, exceptions: 0 };
    const agentRows = rows.filter((candidate) => (candidate.agentName ?? "Unassigned") === key);
    agents.set(key, {
      commissions: existing.commissions + row.commission,
      premium: existing.premium + (row.premium ?? 0),
      groups: new Set(agentRows.map((candidate) => candidate.groupNumber ?? candidate.groupName).filter(Boolean)).size,
      exceptions: existing.exceptions + (row.assignmentStatus === "assigned" ? 0 : 1),
    });
  }
  return [...agents.entries()].map(([agentName, summary]) => ({ agentName, ...summary }));
}
