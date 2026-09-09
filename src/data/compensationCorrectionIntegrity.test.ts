import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createAgent } from "./agents";
import { createAllocationsForLines, updateAllocation } from "./allocations";
import { createCarrier } from "./carriers";
import { createCommission } from "./commissions";
import { confirmCompensationCorrection, previewCompensationCorrection } from "./compensationCorrections";
import { createGroup } from "./groups";
import { createLineOfBusiness } from "./linesOfBusiness";
import { listAllPayouts, listPayoutsForCommission } from "./payouts";
import { buildIndividualReport } from "./reports";
import { createTeam, replaceTeamMembers } from "./teams";
import { createTestDb } from "@/db/test-db";
import { stalePreviewMessage } from "@/domain/compensationCorrection";
import { compensationCorrectionBatches, compensationCorrectionItems } from "@/db/schema";
import { errorChain } from "@/lib/errors";

async function expectImmutableAudit(operation: Promise<unknown>) {
  await operation.then(
    () => {
      throw new Error("expected the database to reject the audit mutation");
    },
    (error: unknown) => {
      expect(errorChain(error)).toMatch(/immutable/i);
    },
  );
}

const initiator = { id: "user-1", email: "mo@example.com", name: "Mo Murillo" };

describe("compensation correction integrity", () => {
  it("rejects a stale preview after allocation or team terms change and protects idempotency plus audit immutability", async () => {
    const db = await createTestDb();
    const john = await createAgent(db, { name: "John Elizondo" });
    const other = await createAgent(db, { name: "Other Agent" });
    const group = await createGroup(db, { name: "ABC COMPANY", primaryAgentId: john.id });
    const carrier = await createCarrier(db, { name: "Principal" });
    const medical = await createLineOfBusiness(db, { name: "Medical" });
    const posted = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 10000,
    });

    const assignmentOnly = await buildIndividualReport(db, {
      kind: "recipient",
      paidMonth: "2026-09",
      personKind: "agent",
      personId: john.id,
    });
    expect(assignmentOnly.payable?.unallocated).toHaveLength(0);

    const first = await createAllocationsForLines(db, {
      groupId: group.id,
      effectiveStart: "2026-09",
      targets: [{ lineOfBusinessId: medical.id, entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }] }],
    });
    const historical = await buildIndividualReport(db, {
      kind: "recipient",
      paidMonth: "2026-09",
      personKind: "agent",
      personId: john.id,
    });
    expect(historical.payable?.unallocated).toHaveLength(0);
    expect(historical.payable?.payableReady).toBe(true);
    expect(historical.totals.compensationCents).toBe(10000);

    const previewA = await previewCompensationCorrection(db, [posted.id]);
    expect(previewA.previewToken).toBeTruthy();
    expect(previewA.totals.proposedRecipientPayableCents).toBe(10000);
    const beforeChange = await listPayoutsForCommission(db, posted.id);

    await updateAllocation(db, first.allocations[0]!.id, { status: "inactive" });
    await createAllocationsForLines(db, {
      groupId: group.id,
      effectiveStart: "2026-09",
      targets: [{
        lineOfBusinessId: medical.id,
        entries: [
          { recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 5000 },
          { recipientType: "agency", compensationBps: 5000 },
        ],
      }],
    });
    await expect(confirmCompensationCorrection(db, {
      commissionIds: [posted.id],
      reason: "Use the first preview",
      confirmationKey: "stale-allocation-1",
      previewToken: previewA.previewToken!,
      initiator,
    })).rejects.toThrow(stalePreviewMessage());
    expect(await listPayoutsForCommission(db, posted.id)).toEqual(beforeChange);

    const team = await createTeam(db, {
      name: "Valley Team",
      members: [{ personKind: "agent", personId: john.id, shareBps: 10000, effectiveStart: "2026-01" }],
    });
    const teamGroup = await createGroup(db, { name: "TEAM COMPANY", primaryAgentId: john.id });
    const teamPosted = await createCommission(db, {
      statementMonth: "2026-09",
      groupId: teamGroup.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 4000,
    });
    await createAllocationsForLines(db, {
      groupId: teamGroup.id,
      effectiveStart: "2026-09",
      targets: [{ lineOfBusinessId: medical.id, entries: [{ recipientType: "team", teamId: team.id, compensationBps: 10000 }] }],
    });
    const teamPreview = await previewCompensationCorrection(db, [teamPosted.id]);
    expect(teamPreview.previewToken).toBeTruthy();
    const teamBefore = await listPayoutsForCommission(db, teamPosted.id);
    await replaceTeamMembers(db, team.id, [
      { personKind: "agent", personId: other.id, shareBps: 10000, effectiveStart: "2026-09" },
    ], { requireComplete: true, closePrior: true });
    await expect(confirmCompensationCorrection(db, {
      commissionIds: [teamPosted.id],
      reason: "Use the team preview",
      confirmationKey: "stale-team-1",
      previewToken: teamPreview.previewToken!,
      initiator,
    })).rejects.toThrow(stalePreviewMessage());
    expect(await listPayoutsForCommission(db, teamPosted.id)).toEqual(teamBefore);

    const fresh = await previewCompensationCorrection(db, [posted.id]);
    const confirmed = await confirmCompensationCorrection(db, {
      commissionIds: [posted.id],
      reason: "Authorized after fresh preview",
      confirmationKey: "same-request-1",
      previewToken: fresh.previewToken!,
      initiator,
    });
    const replay = await confirmCompensationCorrection(db, {
      commissionIds: [posted.id],
      reason: "Authorized after fresh preview",
      confirmationKey: "same-request-1",
      previewToken: fresh.previewToken!,
      initiator,
    });
    expect(replay.batchId).toBe(confirmed.batchId);
    expect(replay.replayed).toBe(true);
    await expect(confirmCompensationCorrection(db, {
      commissionIds: [posted.id],
      reason: "Different reason same key",
      confirmationKey: "same-request-1",
      previewToken: fresh.previewToken!,
      initiator,
    })).rejects.toThrow(/different correction request/);

    await expectImmutableAudit(db.execute(sql`UPDATE compensation_correction_batches SET reason = 'tamper'`));
    await expectImmutableAudit(db.execute(sql`DELETE FROM compensation_correction_items`));
    expect(await db.select().from(compensationCorrectionBatches)).toHaveLength(1);
    expect(await db.select().from(compensationCorrectionItems)).toHaveLength(1);
    expect((await listAllPayouts(db)).filter((row) => row.commissionId === posted.id).every((row) => row.allocationId != null)).toBe(true);
  });
});
