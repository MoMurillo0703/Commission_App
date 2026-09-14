import { describe, expect, it } from "vitest";
import { bulkCompensationPreviewToken, bulkPreviewHasConflicts, planBulkCompensation, resolveBulkProposedEntries, staleBulkPreviewMessage } from "./bulkCompensation";

const owner = { personKind: "agent" as const, personId: 2 };
const people = [
  { personKind: "agent" as const, personId: 1, compensationBps: 7000 },
  { personKind: "agent" as const, personId: 2, compensationBps: 2000 },
  { personKind: "account_manager" as const, personId: 3, compensationBps: 500 },
  { personKind: "account_manager" as const, personId: 4, compensationBps: 500 },
];

describe("bulk compensation preview", () => {
  it("plans versioning, reuse, and conflicts against exact Group + LOB targets", () => {
    const entries = resolveBulkProposedEntries({
      mode: "custom",
      owner,
      people,
      effectiveStart: "2027-03",
    });
    const rows = planBulkCompensation({
      entries,
      effectiveStart: "2027-03",
      proposedSummary: "John 70% · Mo 20% · Laura 5% · Nancy 5%",
      currentSummary: () => "current",
      targets: [
        {
          key: "1:medical",
          groupId: 1,
          groupName: "Alpha",
          lineOfBusinessId: 10,
          lineOfBusinessName: "Group Medical",
          siblingLineIds: [10],
          siblings: [{
            id: 21,
            lineOfBusinessId: 10,
            effectiveStart: "2026-08",
            effectiveEnd: null,
            status: "active",
            entries: [{ recipientType: "agency", compensationBps: 10000 }],
          }],
          current: {
            id: 21,
            lineOfBusinessId: 10,
            effectiveStart: "2026-08",
            effectiveEnd: null,
            status: "active",
            entries: [{ recipientType: "agency", compensationBps: 10000 }],
          },
        },
        {
          key: "2:dental",
          groupId: 2,
          groupName: "Beta",
          lineOfBusinessId: 12,
          lineOfBusinessName: "Group Dental",
          siblingLineIds: [12],
          siblings: [{
            id: 22,
            lineOfBusinessId: 12,
            effectiveStart: "2027-03",
            effectiveEnd: null,
            status: "active",
            entries,
          }],
          current: {
            id: 22,
            lineOfBusinessId: 12,
            effectiveStart: "2027-03",
            effectiveEnd: null,
            status: "active",
            entries,
          },
        },
      ],
    });
    expect(rows[0]).toMatchObject({ action: "version", closePriorEnd: "2027-02" });
    expect(rows[1]).toMatchObject({ action: "reuse" });
    expect(bulkPreviewHasConflicts(rows)).toBe(false);
    const token = bulkCompensationPreviewToken({
      effectiveStart: "2027-03",
      ownerKey: "agent:2",
      templateId: null,
      templateFingerprint: "",
      entries,
      targets: [
        { groupId: 1, lineOfBusinessId: 10, siblingLineIds: [10], siblingFingerprint: "a" },
        { groupId: 2, lineOfBusinessId: 12, siblingLineIds: [12], siblingFingerprint: "b" },
      ],
    });
    expect(token).toHaveLength(64);
    expect(staleBulkPreviewMessage()).toMatch(/stale/);
  });
});
