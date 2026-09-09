import { describe, expect, it } from "vitest";
import {
  allocationHasExactTerms,
  classifyRequestedAllocation,
  classifyRequestedAllocationSet,
  teamMemberFingerprint,
} from "./allocationTerms";

const requested = {
  groupId: 1,
  lineOfBusinessId: 10,
  effectiveStart: "2026-09",
  effectiveEnd: null as string | null,
  status: "active" as const,
  entries: [
    { recipientType: "person" as const, personKind: "agent" as const, personId: 7, compensationBps: 7000 },
    { recipientType: "agency" as const, compensationBps: 3000 },
  ],
};

const matching = {
  groupId: 1,
  lineOfBusinessId: 10,
  effectiveStart: "2026-09",
  effectiveEnd: null as string | null,
  status: "active" as const,
  entries: requested.entries,
};

describe("allocation exact-term comparison", () => {
  it("matches only when group, line, period, status, recipients, and splits are the same", () => {
    expect(allocationHasExactTerms(matching, requested)).toBe(true);
    expect(allocationHasExactTerms({ ...matching, groupId: 2 }, requested)).toBe(false);
    expect(allocationHasExactTerms({ ...matching, lineOfBusinessId: 11 }, requested)).toBe(false);
    expect(allocationHasExactTerms({ ...matching, effectiveStart: "2026-08" }, requested)).toBe(false);
    expect(allocationHasExactTerms({ ...matching, effectiveEnd: "2026-12" }, requested)).toBe(false);
    expect(allocationHasExactTerms({ ...matching, status: "inactive" }, requested)).toBe(false);
    expect(allocationHasExactTerms({
      ...matching,
      entries: [{ recipientType: "agency", compensationBps: 10000 }],
    }, requested)).toBe(false);
    expect(allocationHasExactTerms({
      ...matching,
      entries: [
        { recipientType: "person", personKind: "agent", personId: 8, compensationBps: 7000 },
        { recipientType: "agency", compensationBps: 3000 },
      ],
    }, requested)).toBe(false);
    expect(allocationHasExactTerms({
      ...matching,
      entries: [
        { recipientType: "person", personKind: "agent", personId: 7, compensationBps: 6000 },
        { recipientType: "agency", compensationBps: 4000 },
      ],
    }, requested)).toBe(false);
  });

  it("requires the same team identity and member distribution", () => {
    const teamRequested = {
      ...requested,
      entries: [{ recipientType: "team" as const, teamId: 3, compensationBps: 10000 }],
      teamMembersById: {
        3: [
          { personKind: "agent" as const, personId: 7, shareBps: 5000 },
          { personKind: "account_manager" as const, personId: 4, shareBps: 5000 },
        ],
      },
    };
    const persisted = {
      ...matching,
      entries: [{ recipientType: "team" as const, teamId: 3, compensationBps: 10000 }],
    };
    const matchingMembers = new Map([[3, teamRequested.teamMembersById[3]!]]);
    expect(allocationHasExactTerms(persisted, teamRequested, matchingMembers)).toBe(true);
    expect(allocationHasExactTerms({
      ...persisted,
      entries: [{ recipientType: "team", teamId: 9, compensationBps: 10000 }],
    }, teamRequested, matchingMembers)).toBe(false);
    expect(allocationHasExactTerms(persisted, teamRequested, new Map([[3, [
      { personKind: "agent" as const, personId: 7, shareBps: 10000 },
    ]]]))).toBe(false);
    expect(teamMemberFingerprint(teamRequested.teamMembersById[3])).not.toBe(
      teamMemberFingerprint([{ personKind: "agent", personId: 7, shareBps: 10000 }]),
    );
  });

  it("classifies exact match, incompatible overlap, and missing separately", () => {
    expect(classifyRequestedAllocation([matching], requested).status).toBe("exact");
    expect(classifyRequestedAllocation([{
      ...matching,
      entries: [{ recipientType: "agency", compensationBps: 10000 }],
    }], requested).status).toBe("conflict");
    expect(classifyRequestedAllocation([], requested).status).toBe("missing");
    expect(classifyRequestedAllocation([{
      ...matching,
      effectiveStart: "2026-08",
      entries: [{ recipientType: "agency", compensationBps: 10000 }],
    }], requested).status).toBe("missing");
  });

  it("classifies a requested set as exact, partial, conflict, or missing", () => {
    const dental = { ...requested, lineOfBusinessId: 11 };
    const matchingDental = { ...matching, lineOfBusinessId: 11 };
    expect(classifyRequestedAllocationSet([matching, matchingDental], [requested, dental]).status).toBe("exact");
    expect(classifyRequestedAllocationSet([matching], [requested, dental]).status).toBe("partial");
    expect(classifyRequestedAllocationSet([{
      ...matchingDental,
      entries: [{ recipientType: "agency", compensationBps: 10000 }],
    }, matching], [requested, dental]).status).toBe("conflict");
    expect(classifyRequestedAllocationSet([], [requested, dental]).status).toBe("missing");
  });
});
