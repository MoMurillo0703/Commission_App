import type { AppDatabase } from "@/db";
import { listCommissions, type CommissionView } from "./commissions";
import { listGroups } from "./groups";
import { listLinesOfBusiness } from "./linesOfBusiness";

export { formatStatementMonth } from "@/domain/dates";

export type AgentProduction = {
  key: string;
  agentName: string;
  initials: string;
  groupCount: number;
  lines: string[];
  grossCommissionCents: number;
  unassigned: boolean;
};

export type StatementRollup = {
  key: string;
  carrierName: string;
  statementMonth: string;
  lines: string[];
  groupCount: number;
  grossCommissionCents: number;
  needsReview: boolean;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts.slice(0, 2).map((part) => part[0]!.toUpperCase()).join("");
}

function rollupAgents(rows: CommissionView[]): AgentProduction[] {
  const byAgent = new Map<string, { agentName: string; groupIds: Set<number>; lines: Set<string>; grossCommissionCents: number; unassigned: boolean }>();

  for (const row of rows) {
    const key = row.agentId == null ? "unassigned" : String(row.agentId);
    const existing = byAgent.get(key) ?? {
      agentName: row.agentName ?? "Unassigned",
      groupIds: new Set<number>(),
      lines: new Set<string>(),
      grossCommissionCents: 0,
      unassigned: row.agentId == null,
    };
    existing.groupIds.add(row.groupId);
    existing.lines.add(row.lineOfBusinessName);
    existing.grossCommissionCents += row.grossCommissionCents;
    byAgent.set(key, existing);
  }

  return [...byAgent.entries()]
    .map(([key, value]) => ({
      key,
      agentName: value.agentName,
      initials: value.unassigned ? "?" : initials(value.agentName),
      groupCount: value.groupIds.size,
      lines: [...value.lines],
      grossCommissionCents: value.grossCommissionCents,
      unassigned: value.unassigned,
    }))
    .sort((left, right) => right.grossCommissionCents - left.grossCommissionCents || left.agentName.localeCompare(right.agentName));
}

function rollupStatements(rows: CommissionView[]): StatementRollup[] {
  const byStatement = new Map<string, { carrierName: string; statementMonth: string; lines: Set<string>; groupIds: Set<number>; grossCommissionCents: number; needsReview: boolean }>();

  for (const row of rows) {
    const key = `${row.carrierId}:${row.statementMonth}`;
    const existing = byStatement.get(key) ?? {
      carrierName: row.carrierName,
      statementMonth: row.statementMonth,
      lines: new Set<string>(),
      groupIds: new Set<number>(),
      grossCommissionCents: 0,
      needsReview: false,
    };
    existing.lines.add(row.lineOfBusinessName);
    existing.groupIds.add(row.groupId);
    existing.grossCommissionCents += row.grossCommissionCents;
    existing.needsReview = existing.needsReview || row.agentId == null;
    byStatement.set(key, existing);
  }

  return [...byStatement.entries()]
    .map(([key, value]) => ({
      key,
      carrierName: value.carrierName,
      statementMonth: value.statementMonth,
      lines: [...value.lines],
      groupCount: value.groupIds.size,
      grossCommissionCents: value.grossCommissionCents,
      needsReview: value.needsReview,
    }))
    .sort((left, right) => right.statementMonth.localeCompare(left.statementMonth) || left.carrierName.localeCompare(right.carrierName));
}

export async function getOverview(db?: AppDatabase) {
  const rows = await listCommissions(db);
  const groups = await listGroups(db);
  const lines = await listLinesOfBusiness(db);

  return {
    grossCommissionCents: rows.reduce((sum, row) => sum + row.grossCommissionCents, 0),
    premiumCents: rows.reduce((sum, row) => sum + (row.premiumCents ?? 0), 0),
    groupCount: groups.length,
    lineOfBusinessCount: lines.length,
    needsReview: rows.filter((row) => row.agentId == null).length,
    agents: rollupAgents(rows),
    statements: rollupStatements(rows),
  };
}
