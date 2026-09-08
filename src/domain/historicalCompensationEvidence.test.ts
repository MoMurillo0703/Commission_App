import { describe, expect, it } from "vitest";
import {
  CAL_CHOICE_TEAM_ALLOCATION_BPS,
  classifyHistoricalCompensationEvidence,
  johnShareFromSourceLine,
} from "./historicalCompensationEvidence";

describe("historical compensation evidence", () => {
  it("prepares the Cal Choice Team 70/20/5/5 allocation when remaining recipients are established", () => {
    expect(classifyHistoricalCompensationEvidence({
      johnShareBps: 7000,
      remainingRecipientsEstablished: true,
      calChoiceTeamCoversPaidMonth: true,
    })).toEqual({
      status: "prepare_team_allocation",
      johnShareBps: 7000,
      allocationBps: CAL_CHOICE_TEAM_ALLOCATION_BPS,
    });
  });

  it("does not invent remaining recipients for Integrity-style 50% John terms", () => {
    const classified = classifyHistoricalCompensationEvidence({
      johnShareBps: 5000,
      remainingRecipientsEstablished: false,
    });
    expect(classified.status).toBe("needs_product_owner");
    if (classified.status !== "needs_product_owner") throw new Error("expected product owner confirmation");
    expect(classified.johnShareBps).toBe(5000);
    expect(classified.reason).toMatch(/complete 100%/i);
  });

  it("does not assume Cal Choice Team applies from John 70% alone", () => {
    const classified = classifyHistoricalCompensationEvidence({
      johnShareBps: 7000,
      remainingRecipientsEstablished: false,
    });
    expect(classified.status).toBe("needs_product_owner");
    if (classified.status !== "needs_product_owner") throw new Error("expected product owner confirmation");
    expect(classified.reason).toMatch(/remaining 30%/i);
  });

  it("keeps already-settled items out of reconstruction", () => {
    expect(classifyHistoricalCompensationEvidence({
      alreadySettled: true,
      johnShareBps: 7000,
      remainingRecipientsEstablished: true,
      calChoiceTeamCoversPaidMonth: true,
    })).toEqual({ status: "already_settled" });
  });

  it("derives John's source share without inventing cents", () => {
    expect(johnShareFromSourceLine(10000, 7000)).toBe(7000);
    expect(johnShareFromSourceLine(11306, 5653)).toBe(5000);
    expect(johnShareFromSourceLine(0, 7000)).toBeNull();
  });
});
