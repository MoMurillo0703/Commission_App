import type { UnmatchedImportGroup } from "./importGroups";
import type { UnmatchedNamedImport } from "./namedImport";

export type StatementBlockerKind = "groups" | "lines" | "agents" | "mapping" | "rows";

export type StatementBlocker = {
  kind: StatementBlockerKind;
  count: number;
  message: string;
  actionLabel: string;
  targetId: string;
};

export type StatementReadiness = {
  ready: boolean;
  canContinue: boolean;
  blockers: StatementBlocker[];
  reasons: string[];
  readyCount: number;
  blockedCount: number;
  postedCount: number;
};

const mappingPrefixes = ["Map a group", "Map a carrier", "Map a line of business", "Map a gross commission"];

export function collectMappingBlockers(rows: Array<{ exceptions: string[] }>): string[] {
  const reasons = new Set<string>();
  for (const row of rows) {
    for (const exception of row.exceptions) {
      if (mappingPrefixes.some((prefix) => exception.startsWith(prefix))) reasons.add(exception);
    }
  }
  return [...reasons];
}

export function statementReadiness(input: {
  unmatchedGroups?: UnmatchedImportGroup[];
  unmatchedLines?: UnmatchedNamedImport[];
  unmatchedAgents?: UnmatchedNamedImport[];
  mappingReasons?: string[];
  readyCount: number;
  blockedCount: number;
  postedCount?: number;
}): StatementReadiness {
  const groups = input.unmatchedGroups ?? [];
  const lines = input.unmatchedLines ?? [];
  const agents = input.unmatchedAgents ?? [];
  const mappingReasons = input.mappingReasons ?? [];
  const blockers: StatementBlocker[] = [];

  if (groups.length > 0) {
    blockers.push({
      kind: "groups",
      count: groups.length,
      message: `${groups.length} Group${groups.length === 1 ? " needs" : "s need"} review`,
      actionLabel: `Review ${groups.length} Group${groups.length === 1 ? "" : "s"}`,
      targetId: "resolve-groups",
    });
  }
  if (lines.length > 0) {
    blockers.push({
      kind: "lines",
      count: lines.length,
      message: `${lines.length} Line${lines.length === 1 ? " of Business needs" : "s of Business need"} review`,
      actionLabel: `Review ${lines.length} Line${lines.length === 1 ? "" : "s"} of Business`,
      targetId: "resolve-lines",
    });
  }
  if (agents.length > 0) {
    blockers.push({
      kind: "agents",
      count: agents.length,
      message: `${agents.length} Agent${agents.length === 1 ? " needs" : "s need"} review`,
      actionLabel: `Review ${agents.length} Agent${agents.length === 1 ? "" : "s"}`,
      targetId: "resolve-agents",
    });
  }
  if (mappingReasons.length > 0) {
    blockers.push({
      kind: "mapping",
      count: mappingReasons.length,
      message: mappingReasons.join(" "),
      actionLabel: "Review column mapping",
      targetId: "statement-mapping",
    });
  }

  const entityBlocked = groups.length + lines.length + agents.length + mappingReasons.length > 0;
  if (!entityBlocked && input.blockedCount > 0) {
    blockers.push({
      kind: "rows",
      count: input.blockedCount,
      message: `${input.blockedCount} row${input.blockedCount === 1 ? "" : "s"} still need attention before this statement can post.`,
      actionLabel: "Review rows",
      targetId: "statement-rows",
    });
  } else if (!entityBlocked && input.readyCount === 0 && (input.postedCount ?? 0) === 0) {
    blockers.push({
      kind: "rows",
      count: 0,
      message: "No rows are ready to post.",
      actionLabel: "Review rows",
      targetId: "statement-rows",
    });
  }

  const reasons = blockers.map((blocker) => blocker.message);
  const canContinue = !entityBlocked && input.blockedCount === 0 && input.readyCount > 0;

  return {
    ready: canContinue,
    canContinue,
    blockers,
    reasons,
    readyCount: input.readyCount,
    blockedCount: input.blockedCount,
    postedCount: input.postedCount ?? 0,
  };
}

export function continueImportBlockedReason(readiness: StatementReadiness | null) {
  if (!readiness) return "Review the statement first so the app can list anything that still needs a decision.";
  if (readiness.canContinue) return null;
  if (readiness.reasons.length === 0) return "Continue Import is unavailable until the statement is ready.";
  return `Continue Import is unavailable: ${readiness.reasons.join(" ")}`;
}
