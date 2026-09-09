import { describe, expect, it } from "vitest";
import { createAgent } from "./agents";
import { createAllocationsForLines, listAllocations, updateAllocation } from "./allocations";
import { createCarrier } from "./carriers";
import { createCommission, getCommission } from "./commissions";
import { confirmCompensationCorrection, listCorrectionAuditForCommission, previewCompensationCorrection } from "./compensationCorrections";
import { listPostedCompensationExceptions } from "./compensationExceptions";
import { createGroup } from "./groups";
import { createLineOfBusiness } from "./linesOfBusiness";
import { listAllPayouts, listPayoutsForCommission } from "./payouts";
import { buildIndividualReport } from "./reports";
import { exportReportDocument } from "./reportExport";
import { createTestDb } from "@/db/test-db";
import { individualReportDocument } from "@/domain/reportDocuments";
import {
  exceptionWorkSummary,
  groupCompensationExceptions,
} from "@/domain/compensationExceptions";
import { newerAllocationBlockedMessage } from "@/domain/compensationCorrection";
import { formatCents } from "@/domain/money";

const initiator = { id: "user-1", email: "mo@example.com", name: "Mo Murillo" };

describe("authorized historical compensation correction", () => {
  it("corrects six genuine Agency fallbacks atomically and leaves legitimate null-allocation settlements untouched", async () => {
    const db = await createTestDb();
    const john = await createAgent(db, { name: "John Elizondo" });
    const abc = await createGroup(db, { name: "ABC COMPANY", primaryAgentId: john.id });
    const xyz = await createGroup(db, { name: "XYZ COMPANY", primaryAgentId: john.id });
    const def = await createGroup(db, { name: "DEF COMPANY", primaryAgentId: john.id });
    const other = await createAgent(db, { name: "Other Agent" });
    const otherGroup = await createGroup(db, { name: "OTHER COMPANY", primaryAgentId: other.id });
    const carrier = await createCarrier(db, { name: "Principal" });
    const medical = await createLineOfBusiness(db, { name: "Medical" });
    const dental = await createLineOfBusiness(db, { name: "Dental" });

    const posted = [];
    for (const row of [
      { groupId: abc.id, lineOfBusinessId: medical.id, cents: 10000 },
      { groupId: abc.id, lineOfBusinessId: medical.id, cents: -1500 },
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

    const legitimate = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: abc.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 5000,
      compensationBps: 7000,
    });
    expect((await listPayoutsForCommission(db, legitimate.id)).some((payout) => payout.allocationId == null && payout.recipientType === "person")).toBe(true);

    const assignedOnly = await buildIndividualReport(db, {
      kind: "recipient",
      paidMonth: "2026-09",
      personKind: "agent",
      personId: john.id,
    });
    expect(assignedOnly.payable?.unallocated).toHaveLength(0);
    expect(assignedOnly.payable?.reviewHref).toBeNull();
    const reviewIds = posted.map((row) => row.id);

    const exceptions = await listPostedCompensationExceptions(db, { paidMonth: "2026-09", commissionIds: reviewIds });
    expect(exceptions).toHaveLength(6);
    expect(groupCompensationExceptions(exceptions).map((group) => group.groupName)).toEqual(["ABC COMPANY", "DEF COMPANY", "XYZ COMPANY"]);

    const newerPreview = await previewCompensationCorrection(db, reviewIds);
    expect(newerPreview.correctableIds).toEqual([]);
    expect(newerPreview.items.every((item) => item.blockedReason?.includes("covers the original paid month"))).toBe(true);

    const newer = await createAllocationsForLines(db, {
      groupId: abc.id,
      effectiveStart: "2026-10",
      targets: [
        { lineOfBusinessId: medical.id, entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }] },
        { lineOfBusinessId: dental.id, entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }] },
      ],
    });
    const blockedNewer = await previewCompensationCorrection(db, [posted[0]!.id]);
    expect(blockedNewer.items[0]?.blockedReason).toBe(newerAllocationBlockedMessage());
    await expect(confirmCompensationCorrection(db, {
      commissionIds: [posted[0]!.id],
      reason: "Should not use newer allocation",
      confirmationKey: "blocked-newer-1",
      previewToken: blockedNewer.previewToken ?? "missing-preview-token-value",
      initiator,
    })).rejects.toThrow(/newer allocation|covers the original paid month|cannot be corrected|exact preview/);
    for (const allocation of newer.allocations) {
      await updateAllocation(db, allocation.id, { status: "inactive" });
    }

    for (const target of [
      { groupId: abc.id, lines: [medical.id, dental.id] },
      { groupId: xyz.id, lines: [medical.id, dental.id] },
      { groupId: def.id, lines: [medical.id] },
    ]) {
      await createAllocationsForLines(db, {
        groupId: target.groupId,
        effectiveStart: "2026-09",
        targets: target.lines.map((lineOfBusinessId) => ({
          lineOfBusinessId,
          entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }],
        })),
      });
    }

    const allocations = await listAllocations(db);
    const grouped = groupCompensationExceptions(exceptions, allocations);
    expect(exceptionWorkSummary(grouped).readyCommissionIds).toHaveLength(6);
    expect(grouped.every((group) => group.lines.every((line) => line.status === "ready_to_correct"))).toBe(true);
    const johnReady = await buildIndividualReport(db, {
      kind: "recipient",
      paidMonth: "2026-09",
      personKind: "agent",
      personId: john.id,
    });
    expect(johnReady.payable?.unallocated).toHaveLength(0);
    expect(johnReady.payable?.payableReady).toBe(true);
    expect(johnReady.payable?.message).toBeNull();
    expect(johnReady.rows.filter((row) => reviewIds.includes(row.commissionId ?? 0))).toHaveLength(6);

    const preview = await previewCompensationCorrection(db, reviewIds);
    expect(preview.previewToken).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.correctableIds.sort((left, right) => left - right)).toEqual(reviewIds.sort((left, right) => left - right));
    expect(preview.items[0]?.original.label).toBe("Agency 100%");
    expect(preview.totals.grossCents).toBe(10000 - 1500 + 4000 + 3000 + 1500 + 800);
    expect(preview.totals.originalAgencyCents).toBe(preview.totals.grossCents);
    expect(preview.totals.proposedRecipientPayableCents).toBe(preview.totals.grossCents);
    expect(preview.totals.resultingAgencyCents).toBe(0);
    expect(preview.items.find((item) => item.grossCommissionCents < 0)?.proposed?.recipientPayableCents).toBe(-1500);

    const beforePayouts = await listAllPayouts(db);
    await expect(confirmCompensationCorrection(db, {
      commissionIds: [...reviewIds, posted[0]!.id + 9999],
      reason: "Attempt mixed invalid batch",
      confirmationKey: "batch-fail-1",
      previewToken: preview.previewToken ?? "missing-preview-token-value",
      initiator,
    })).rejects.toThrow(/not found|cannot be corrected|no longer matches/);
    expect((await listAllPayouts(db)).map((row) => ({ id: row.id, allocationId: row.allocationId, cents: row.compensationCents }))).toEqual(
      beforePayouts.map((row) => ({ id: row.id, allocationId: row.allocationId, cents: row.compensationCents })),
    );

    const confirmed = await confirmCompensationCorrection(db, {
      commissionIds: reviewIds,
      reason: "September 2026 missing allocation fallback for John Elizondo",
      confirmationKey: "correct-six-001",
      previewToken: preview.previewToken!,
      initiator,
    });
    expect(confirmed.replayed).toBe(false);
    expect(confirmed.commissionIds.sort((left, right) => left - right)).toEqual(reviewIds.sort((left, right) => left - right));
    expect(confirmed.initiator).toEqual(initiator);

    const replay = await confirmCompensationCorrection(db, {
      commissionIds: reviewIds,
      reason: "September 2026 missing allocation fallback for John Elizondo",
      confirmationKey: "correct-six-001",
      previewToken: preview.previewToken!,
      initiator,
    });
    expect(replay.replayed).toBe(true);
    expect(replay.batchId).toBe(confirmed.batchId);

    await expect(confirmCompensationCorrection(db, {
      commissionIds: reviewIds,
      reason: "Different request against the same key",
      confirmationKey: "correct-six-001",
      previewToken: preview.previewToken!,
      initiator,
    })).rejects.toThrow(/different correction request/);

    await expect(confirmCompensationCorrection(db, {
      commissionIds: reviewIds,
      reason: "Second attempt",
      confirmationKey: "correct-six-002",
      previewToken: preview.previewToken!,
      initiator,
    })).rejects.toThrow(/already exists for this commission|already corrected|not an eligible|cannot be corrected|no longer matches/);

    for (const commission of posted) {
      const payouts = await listPayoutsForCommission(db, commission.id);
      expect(payouts.some((payout) => payout.recipientType === "person" && payout.personId === john.id)).toBe(true);
      expect(payouts.some((payout) => payout.recipientType === "agency" && payout.compensationCents !== 0)).toBe(false);
      expect(payouts.every((payout) => payout.allocationId != null)).toBe(true);
      expect(payouts.reduce((sum, payout) => sum + (payout.recipientType === "person" || payout.recipientType === "team_member" ? payout.compensationCents : 0), 0)).toBe(commission.grossCommissionCents);
      const header = await getCommission(db, commission.id);
      expect(header?.grossCommissionCents).toBe(commission.grossCommissionCents);
      expect(header?.statementMonth).toBe("2026-09");
      expect(header?.agencyNetCents).toBe(0);
      expect(header?.agentCompensationCents).toBe(commission.grossCommissionCents);
      const audit = await listCorrectionAuditForCommission(db, commission.id);
      expect(audit).toHaveLength(1);
      const original = JSON.parse(audit[0]!.originalPayoutsJson) as Array<{ recipientType: string; compensationCents: number }>;
      expect(original).toEqual([expect.objectContaining({ recipientType: "agency", compensationCents: commission.grossCommissionCents })]);
    }

    const legitimateAfter = await listPayoutsForCommission(db, legitimate.id);
    expect(legitimateAfter.every((payout) => payout.allocationId == null)).toBe(true);
    expect((await getCommission(db, legitimate.id))?.agentCompensationCents).toBeGreaterThan(0);

    const afterExceptions = await listPostedCompensationExceptions(db, { paidMonth: "2026-09", commissionIds: reviewIds });
    expect(afterExceptions).toHaveLength(0);

    const afterReport = await buildIndividualReport(db, {
      kind: "recipient",
      paidMonth: "2026-09",
      personKind: "agent",
      personId: john.id,
    });
    expect(afterReport.payable?.payableReady).toBe(true);
    expect(afterReport.payable?.unallocated).toHaveLength(0);
    const johnRows = afterReport.rows.filter((row) => row.personId === john.id && reviewIds.includes(row.commissionId ?? 0));
    expect(johnRows).toHaveLength(6);
    expect(johnRows.reduce((sum, row) => sum + row.compensationCents, 0)).toBe(17800);
    expect(afterReport.totals.compensationCents).toBe(afterReport.rows.reduce((sum, row) => sum + row.compensationCents, 0));
    expect(afterReport.rows.some((row) => row.commissionId === legitimate.id)).toBe(true);

    const document = individualReportDocument(
      afterReport.rows,
      afterReport.totals,
      afterReport.filters,
      afterReport.names,
      "John Elizondo",
    );
    expect(document.footerTotals?.find((total) => total.label === "TOTAL PAYABLE TO JOHN ELIZONDO")?.value).toBe(formatCents(afterReport.totals.compensationCents));
    const pdf = await exportReportDocument(document, "pdf");
    const { extractText, getDocumentProxy } = await import("unpdf");
    const parsed = await getDocumentProxy(new Uint8Array(pdf.body as Uint8Array));
    const extracted = await extractText(parsed, { mergePages: true });
    const text = Array.isArray(extracted.text) ? extracted.text.join(" ") : extracted.text;
    expect(text).toMatch(/JOHN ELIZONDO/);
    expect(text).toMatch(/TOTAL PAYABLE TO JOHN ELIZONDO/i);

    const otherCommission = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: otherGroup.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 2200,
    });
    const johnAgain = await buildIndividualReport(db, {
      kind: "recipient",
      paidMonth: "2026-09",
      personKind: "agent",
      personId: john.id,
    });
    expect(johnAgain.payable?.unallocated.map((row) => row.commissionId)).not.toContain(otherCommission.id);
  });
});
