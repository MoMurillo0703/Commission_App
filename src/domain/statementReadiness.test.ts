import { describe, expect, it } from "vitest";
import { continueImportBlockedReason, isStatementFullyPosted, statementReadiness } from "./statementReadiness";

describe("statement readiness", () => {
  it("blocks continuation while groups need review and names the action", () => {
    const readiness = statementReadiness({
      unmatchedGroups: [{ key: "name:acme", sourceName: "Acme", sourceNumber: null, rowCount: 4 }],
      readyCount: 0,
      blockedCount: 4,
    });
    expect(readiness.canContinue).toBe(false);
    expect(readiness.blockers[0]).toMatchObject({
      kind: "groups",
      count: 1,
      actionLabel: "Review 1 Group",
    });
    expect(continueImportBlockedReason(readiness)).toMatch(/1 Group needs review/);
  });

  it("surfaces unmatched lines and agents as separate blockers", () => {
    const readiness = statementReadiness({
      unmatchedLines: [{ key: "name:ppo", sourceName: "PPO", rowCount: 3 }],
      unmatchedAgents: [{ key: "name:pat", sourceName: "Pat Lee", rowCount: 2 }],
      readyCount: 1,
      blockedCount: 5,
    });
    expect(readiness.blockers.map((item) => item.kind)).toEqual(["lines", "agents"]);
    expect(readiness.blockers.map((item) => item.actionLabel)).toEqual([
      "Review 1 Line of Business",
      "Review 1 Agent",
    ]);
    expect(readiness.canContinue).toBe(false);
  });

  it("enables continuation only after required blockers are gone and rows are ready", () => {
    expect(statementReadiness({ readyCount: 3, blockedCount: 1 }).canContinue).toBe(false);
    expect(statementReadiness({ readyCount: 3, blockedCount: 1 }).blockers[0]).toMatchObject({ kind: "rows", count: 1 });
    expect(statementReadiness({ readyCount: 3, blockedCount: 0 }).canContinue).toBe(true);
    expect(statementReadiness({ readyCount: 0, blockedCount: 2 }).canContinue).toBe(false);
    expect(continueImportBlockedReason(null)).toMatch(/Review the statement first/i);
  });

  it("does not leave an unexplained disabled continue state", () => {
    const readiness = statementReadiness({
      unmatchedGroups: [{ key: "name:a", sourceName: "A", sourceNumber: null, rowCount: 1 }],
      unmatchedLines: [{ key: "name:b", sourceName: "B", rowCount: 1 }],
      readyCount: 0,
      blockedCount: 2,
    });
    const reason = continueImportBlockedReason(readiness);
    expect(reason).toBeTruthy();
    expect(reason).toMatch(/Group/);
    expect(reason).toMatch(/Line/);
  });

  it("does not describe a fully posted statement as a blocked import", () => {
    const readiness = statementReadiness({
      readyCount: 0,
      blockedCount: 0,
      postedCount: 30,
    });
    expect(readiness.canContinue).toBe(false);
    expect(isStatementFullyPosted(readiness)).toBe(true);
    expect(continueImportBlockedReason(readiness)).toBeNull();
    expect(readiness.reasons).toEqual([]);
  });
});
