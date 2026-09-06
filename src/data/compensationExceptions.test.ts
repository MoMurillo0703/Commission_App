import { describe, expect, it } from "vitest";
import { createAgent } from "./agents";
import { createAllocationsForLines, listAllocations } from "./allocations";
import { createCarrier } from "./carriers";
import { createCommission } from "./commissions";
import { listPostedCompensationExceptions } from "./compensationExceptions";
import { createGroup } from "./groups";
import { createLineOfBusiness } from "./linesOfBusiness";
import { listAllPayouts } from "./payouts";
import { buildIndividualReport } from "./reports";
import { createTestDb } from "@/db/test-db";
import {
  exceptionWorkSummary,
  groupCompensationExceptions,
  parseCommissionIds,
} from "@/domain/compensationExceptions";

describe("report to compensation exception workflow", () => {
  it("makes six snapshot-less posted commissions actionable without rewriting payouts", async () => {
    const db = await createTestDb();
    const john = await createAgent(db, { name: "John Elizondo" });
    const abc = await createGroup(db, { name: "ABC COMPANY", primaryAgentId: john.id });
    const xyz = await createGroup(db, { name: "XYZ COMPANY", primaryAgentId: john.id });
    const def = await createGroup(db, { name: "DEF COMPANY", primaryAgentId: john.id });
    const carrier = await createCarrier(db, { name: "Principal" });
    const medical = await createLineOfBusiness(db, { name: "Medical" });
    const dental = await createLineOfBusiness(db, { name: "Dental" });

    const posted = [];
    for (const row of [
      { groupId: abc.id, lineOfBusinessId: medical.id, cents: 10000 },
      { groupId: abc.id, lineOfBusinessId: medical.id, cents: 2500 },
      { groupId: abc.id, lineOfBusinessId: dental.id, cents: 4000 },
      { groupId: xyz.id, lineOfBusinessId: medical.id, cents: 3000 },
      { groupId: xyz.id, lineOfBusinessId: dental.id, cents: 1500 },
      { groupId: def.id, lineOfBusinessId: medical.id, cents: 800 },
    ]) {
      posted.push(await createCommission(db, {
        statementMonth: "2026-09",
        groupId: row.groupId,
        carrierId: carrier.id,
        lineOfBusinessId: row.lineOfBusinessId,
        grossCommissionCents: row.cents,
      }));
    }

    const report = await buildIndividualReport(db, {
      kind: "recipient",
      paidMonth: "2026-09",
      personKind: "agent",
      personId: john.id,
    });
    expect(report.payable?.payableReady).toBe(false);
    expect(report.payable?.unallocated).toHaveLength(6);
    expect(report.payable?.message).toMatch(/6 commissions need compensation setup/);
    expect(report.payable?.reviewHref).toContain("/compensation?review=1");
    expect(report.payable?.reviewHref).toContain("paidMonth=2026-09");
    const reviewIds = parseCommissionIds(new URL(report.payable!.reviewHref!, "https://app.local").searchParams.get("commissionIds"));
    expect(reviewIds.sort((left, right) => left - right)).toEqual(posted.map((row) => row.id).sort((left, right) => left - right));

    const exceptions = await listPostedCompensationExceptions(db, {
      paidMonth: "2026-09",
      commissionIds: reviewIds,
    });
    expect(exceptions).toHaveLength(6);
    const grouped = groupCompensationExceptions(exceptions);
    expect(grouped.map((group) => group.groupName)).toEqual(["ABC COMPANY", "DEF COMPANY", "XYZ COMPANY"]);
    expect(grouped.find((group) => group.groupName === "ABC COMPANY")?.lines.map((line) => line.lineOfBusinessName)).toEqual(["Dental", "Medical"]);
    expect(exceptionWorkSummary(grouped).commissionCount).toBe(6);

    const beforePayouts = await listAllPayouts(db);
    expect(beforePayouts.filter((payout) => reviewIds.includes(payout.commissionId)).every((payout) => payout.allocationId == null)).toBe(true);

    await createAllocationsForLines(db, {
      groupId: abc.id,
      effectiveStart: "2026-09",
      targets: [
        { lineOfBusinessId: medical.id, entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }] },
        { lineOfBusinessId: dental.id, entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }] },
      ],
    });

    const afterAllocations = await listAllocations(db);
    const afterExceptions = groupCompensationExceptions(exceptions, afterAllocations);
    const remaining = exceptionWorkSummary(afterExceptions);
    expect(remaining.groups.map((group) => group.groupName)).toEqual(["DEF COMPANY", "XYZ COMPANY"]);
    expect(afterExceptions.find((group) => group.groupName === "ABC COMPANY")?.lines.every((line) => line.status === "allocation_exists_history_unchanged")).toBe(true);

    const afterPayouts = await listAllPayouts(db);
    expect(afterPayouts.filter((payout) => reviewIds.includes(payout.commissionId)).map((payout) => ({
      commissionId: payout.commissionId,
      allocationId: payout.allocationId,
      recipientType: payout.recipientType,
      compensationCents: payout.compensationCents,
    }))).toEqual(beforePayouts.filter((payout) => reviewIds.includes(payout.commissionId)).map((payout) => ({
      commissionId: payout.commissionId,
      allocationId: payout.allocationId,
      recipientType: payout.recipientType,
      compensationCents: payout.compensationCents,
    })));

    const afterReport = await buildIndividualReport(db, {
      kind: "recipient",
      paidMonth: "2026-09",
      personKind: "agent",
      personId: john.id,
    });
    expect(afterReport.payable?.unallocated).toHaveLength(6);
    expect(afterReport.payable?.payableReady).toBe(false);
  });
});
