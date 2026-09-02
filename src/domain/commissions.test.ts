import { describe, expect, it } from "vitest";
import { CommissionRow, summarize, summarizeByAgent } from "./commissions";

const rows: CommissionRow[] = [
  { id: "1", carrier: "Carrier A", statementPeriod: "2026-08", groupName: "Acme", groupNumber: "A1", lineOfBusiness: "Medical", productName: "PPO", premium: 10000, commission: 500, agentName: "Alex", assignmentStatus: "assigned" },
  { id: "2", carrier: "Carrier A", statementPeriod: "2026-08", groupName: "Beta", groupNumber: "B1", lineOfBusiness: "Dental", productName: "Dental", premium: null, commission: 120, agentName: null, assignmentStatus: "unassigned" },
];

describe("commission summaries", () => {
  it("totals agency commissions, available premium, groups, and exceptions", () => {
    expect(summarize(rows)).toEqual({ commissions: 620, premium: 10000, groups: 2, exceptions: 1 });
  });

  it("keeps unassigned production visible in agent reporting", () => {
    expect(summarizeByAgent(rows)).toEqual([
      { agentName: "Alex", commissions: 500, premium: 10000, groups: 1, exceptions: 0 },
      { agentName: "Unassigned", commissions: 120, premium: 0, groups: 1, exceptions: 1 },
    ]);
  });
});
