import { describe, expect, it } from "vitest";
import {
  canRenderIndividualRows,
  individualRecipientTypeLabel,
  individualReportNeedsRecipientAndMonth,
  renderedReportKind,
} from "./reportWorkspace";

describe("individual report workspace", () => {
  it("requires a recipient and paid month and does not treat agency data as individual rows", () => {
    expect(individualReportNeedsRecipientAndMonth("individual")).toBe(true);
    expect(individualReportNeedsRecipientAndMonth("recipient")).toBe(true);
    expect(individualReportNeedsRecipientAndMonth("agency")).toBe(false);
    expect(renderedReportKind({ filters: { kind: "agency" } })).toBe("agency");
    expect(canRenderIndividualRows({
      filters: { kind: "agency" },
      rows: [{ groupName: "Acme", grossCommissionCents: 1000 }],
    })).toBe(false);
    expect(canRenderIndividualRows({
      filters: { kind: "individual" },
      rows: [{ recipientName: "John", compensationCents: 7000 }],
    })).toBe(true);
    expect(individualRecipientTypeLabel({ personKind: "agent", teamName: null })).toBe("Agent");
    expect(individualRecipientTypeLabel({ personKind: "account_manager", teamName: "Valley" })).toBe("Team member · Account manager");
  });
});
