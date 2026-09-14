import { describe, expect, it } from "vitest";
import { createAccountManager } from "./accountManagers";
import { createAgencyCompensationOwner } from "./agencyOwner";
import { createAgent } from "./agents";
import { createAllocation, listAllocations } from "./allocations";
import { commitBulkCompensation, previewBulkCompensation } from "./bulkCompensation";
import { createCarrier } from "./carriers";
import { loadCompensationDirectory } from "./compensationDirectory";
import { createCommission } from "./commissions";
import { createGroup, updateGroup } from "./groups";
import { createLineOfBusiness } from "./linesOfBusiness";
import { createTeam, listTeams, replaceTeamMembers } from "./teams";
import { emptyCompensationDirectoryFilters } from "@/domain/compensationDirectory";
import { evaluateIndividualEarnings } from "@/domain/currentEarnings";
import { allocationCandidates } from "./allocations";
import { createTestDb } from "@/db/test-db";
import { agencyCompensationOwners } from "@/db/schema";
import { ConflictError, ValidationError } from "@/lib/errors";
import { eq } from "drizzle-orm";
import { listAgencyCompensationOwners } from "./agencyOwner";

async function seed() {
  const db = await createTestDb();
  const john = await createAgent(db, { name: "John Elizondo" });
  const mo = await createAgent(db, { name: "Mo Murillo" });
  const other = await createAgent(db, { name: "Other Agent" });
  const laura = await createAccountManager(db, { name: "Laura Montoya" });
  const nancy = await createAccountManager(db, { name: "Nancy" });
  await createAgencyCompensationOwner(db, { agentId: mo.id, effectiveStartMonth: "2026-01" });
  const calChoice = await createCarrier(db, { name: "CaliforniaChoice" });
  const choiceBuilder = await createCarrier(db, { name: "ChoiceBuilder" });
  const medical = await createLineOfBusiness(db, { name: "Group Medical" });
  const dental = await createLineOfBusiness(db, { name: "Group Dental" });
  const vision = await createLineOfBusiness(db, { name: "Group Vision" });
  const med = await createLineOfBusiness(db, { name: "MED" });
  const alpha = await createGroup(db, { name: "Alpha Group", primaryAgentId: john.id, accountManagerId: laura.id });
  const beta = await createGroup(db, { name: "Beta Group", primaryAgentId: john.id, accountManagerId: nancy.id });
  const untouched = await createGroup(db, { name: "Untouched Group", primaryAgentId: other.id, accountManagerId: laura.id });
  await createCommission(db, {
    statementMonth: "2026-08",
    groupId: alpha.id,
    carrierId: calChoice.id,
    lineOfBusinessId: medical.id,
    grossCommissionCents: 10000,
  });
  await createCommission(db, {
    statementMonth: "2026-08",
    groupId: beta.id,
    carrierId: choiceBuilder.id,
    lineOfBusinessId: dental.id,
    grossCommissionCents: 8000,
  });
  await createCommission(db, {
    statementMonth: "2026-08",
    groupId: untouched.id,
    carrierId: calChoice.id,
    lineOfBusinessId: vision.id,
    grossCommissionCents: 5000,
  });
  const team = await createTeam(db, {
    name: "Cal Choice Team",
    members: [
      { personKind: "agent", personId: john.id, shareBps: 7000, effectiveStart: "2026-08" },
      { personKind: "agent", personId: mo.id, shareBps: 2000, effectiveStart: "2026-08" },
      { personKind: "account_manager", personId: laura.id, shareBps: 500, effectiveStart: "2026-08" },
      { personKind: "account_manager", personId: nancy.id, shareBps: 500, effectiveStart: "2026-08" },
    ],
  });
  const people = [
    { personKind: "agent" as const, personId: john.id, compensationBps: 7000 },
    { personKind: "agent" as const, personId: mo.id, compensationBps: 2000 },
    { personKind: "account_manager" as const, personId: laura.id, compensationBps: 500 },
    { personKind: "account_manager" as const, personId: nancy.id, compensationBps: 500 },
  ];
  return { db, john, mo, other, laura, nancy, calChoice, medical, dental, vision, med, alpha, beta, untouched, team, people };
}

describe("person-centric bulk compensation", () => {
  it("selects the full server-filtered set, previews, commits people terms atomically, and leaves unselected targets unchanged", async () => {
    const { db, john, medical, dental, vision, alpha, beta, untouched, team, people } = await seed();
    const directory = await loadCompensationDirectory(db, {
      ...emptyCompensationDirectoryFilters("2026-08"),
      carrierId: null,
      primaryAgentId: john.id,
    });
    expect(directory.keys.length).toBeGreaterThanOrEqual(2);
    expect(directory.targets.some((target) => target.groupId === untouched.id)).toBe(false);

    const preview = await previewBulkCompensation(db, {
      effectiveStart: "2026-08",
      mode: "template",
      teamId: team.id,
      targets: directory.targets,
    });
    expect(preview.targetCount).toBe(directory.total);
    expect(preview.proposedSummary).toContain("John");
    expect(preview.proposedSummary).toContain("Mo 20%");
    expect(preview.hasConflicts).toBe(false);

    const committed = await commitBulkCompensation(db, {
      effectiveStart: "2026-08",
      mode: "template",
      teamId: team.id,
      targets: directory.targets,
      previewToken: preview.previewToken,
    });
    expect(committed.createdCount).toBe(directory.total);

    const allocations = await listAllocations(db);
    const written = allocations.filter((row) => row.effectiveStart === "2026-08" && row.status === "active");
    expect(written.every((row) => row.entries.every((entry) => entry.recipientType !== "team"))).toBe(true);
    expect(written.find((row) => row.groupId === alpha.id && row.lineOfBusinessId === medical.id)?.entries.map((entry) => entry.recipientType).sort()).toEqual(["agency", "person", "person", "person"]);
    expect(written.some((row) => row.groupId === untouched.id)).toBe(false);
    expect(allocations.filter((row) => row.groupId === untouched.id && row.lineOfBusinessId === vision.id)).toHaveLength(0);

    const retry = await commitBulkCompensation(db, {
      effectiveStart: "2026-08",
      mode: "template",
      teamId: team.id,
      targets: directory.targets,
      previewToken: preview.previewToken,
    });
    expect(retry.createdCount).toBe(0);
    expect(retry.reusedCount).toBe(directory.total);
    expect((await listAllocations(db)).filter((row) => row.effectiveStart === "2026-08")).toHaveLength(written.length);

    await replaceTeamMembers(db, team.id, [
      { personKind: "agent", personId: john.id, shareBps: 10000, effectiveStart: "2026-09" },
    ], { requireComplete: true, closePrior: true });
    const afterTeamChange = (await listAllocations(db)).find((row) => row.groupId === alpha.id && row.lineOfBusinessId === medical.id);
    expect(afterTeamChange?.entries.find((entry) => entry.recipientType === "person" && entry.personId === john.id)?.compensationBps).toBe(7000);

    const later = await previewBulkCompensation(db, {
      effectiveStart: "2027-03",
      mode: "custom",
      people,
      targets: [{ groupId: alpha.id, lineOfBusinessId: medical.id }],
    });
    await commitBulkCompensation(db, {
      effectiveStart: "2027-03",
      mode: "custom",
      people,
      targets: [{ groupId: alpha.id, lineOfBusinessId: medical.id }],
      previewToken: later.previewToken,
    });
    const versions = (await listAllocations(db)).filter((row) => row.groupId === alpha.id && row.lineOfBusinessId === medical.id);
    expect(versions.find((row) => row.effectiveStart === "2026-08")?.effectiveEnd).toBe("2027-02");
    expect(versions.find((row) => row.effectiveStart === "2027-03")?.effectiveEnd).toBeNull();
  });

  it("rejects a stale preview and rolls back when one target conflicts", async () => {
    const { db, john, mo, laura, nancy, medical, dental, alpha, beta, people } = await seed();
    const preview = await previewBulkCompensation(db, {
      effectiveStart: "2026-08",
      mode: "custom",
      people,
      targets: [
        { groupId: alpha.id, lineOfBusinessId: medical.id },
        { groupId: beta.id, lineOfBusinessId: dental.id },
      ],
    });
    await createAllocation(db, {
      groupId: alpha.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2026-08",
      entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }],
    });
    await expect(commitBulkCompensation(db, {
      effectiveStart: "2026-08",
      mode: "custom",
      people,
      targets: [
        { groupId: alpha.id, lineOfBusinessId: medical.id },
        { groupId: beta.id, lineOfBusinessId: dental.id },
      ],
      previewToken: preview.previewToken,
    })).rejects.toBeInstanceOf(ConflictError);
    expect((await listAllocations(db)).filter((row) => row.groupId === beta.id)).toHaveLength(0);

    await createAllocation(db, {
      groupId: beta.id,
      lineOfBusinessId: dental.id,
      effectiveStart: "2026-08",
      entries: [{ recipientType: "agency", compensationBps: 10000 }],
    });
    await expect(previewBulkCompensation(db, {
      effectiveStart: "2026-08",
      mode: "custom",
      people,
      targets: [{ groupId: beta.id, lineOfBusinessId: dental.id }],
    }).then((row) => row.hasConflicts)).resolves.toBe(true);

    const conflictPreview = await previewBulkCompensation(db, {
      effectiveStart: "2026-09",
      mode: "custom",
      people: [
        { personKind: "agent", personId: john.id, compensationBps: 7000 },
        { personKind: "agent", personId: mo.id, compensationBps: 2000 },
        { personKind: "account_manager", personId: laura.id, compensationBps: 500 },
        { personKind: "account_manager", personId: nancy.id, compensationBps: 500 },
      ],
      targets: [
        { groupId: alpha.id, lineOfBusinessId: medical.id },
        { groupId: beta.id, lineOfBusinessId: dental.id },
      ],
    });
    await createAllocation(db, {
      groupId: beta.id,
      lineOfBusinessId: dental.id,
      effectiveStart: "2026-09",
      entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }],
    });
    const before = await listAllocations(db);
    await expect(commitBulkCompensation(db, {
      effectiveStart: "2026-09",
      mode: "custom",
      people,
      targets: [
        { groupId: alpha.id, lineOfBusinessId: medical.id },
        { groupId: beta.id, lineOfBusinessId: dental.id },
      ],
      previewToken: conflictPreview.previewToken,
    })).rejects.toBeInstanceOf(ConflictError);
    expect((await listAllocations(db)).map((row) => `${row.id}:${row.effectiveStart}:${row.effectiveEnd ?? ""}`))
      .toEqual(before.map((row) => `${row.id}:${row.effectiveStart}:${row.effectiveEnd ?? ""}`));
  });

  it("does not change compensation when assignment changes and defaults to Mo 100%", async () => {
    const { db, john, other, medical, alpha } = await seed();
    const directory = await loadCompensationDirectory(db, emptyCompensationDirectoryFilters("2026-08"));
    expect(directory.rows.find((row) => row.groupId === alpha.id)?.compensationLabel).toBe("Mo 100% — Default");
    const before = await listAllocations(db);
    await updateGroup(db, alpha.id, { name: alpha.name, primaryAgentId: other.id });
    expect(await listAllocations(db)).toEqual(before);
    const after = await loadCompensationDirectory(db, {
      ...emptyCompensationDirectoryFilters("2026-08"),
      primaryAgentId: other.id,
    });
    expect(after.rows.some((row) => row.groupId === alpha.id)).toBe(true);
    expect(after.rows.find((row) => row.groupId === alpha.id)?.compensationLabel).toBe("Mo 100% — Default");
    expect(john.id).not.toBe(other.id);
  });

  it("rejects Mo + Agency duplicate writes and missing owner months", async () => {
    const db = await createTestDb();
    const john = await createAgent(db, { name: "John Elizondo" });
    const mo = await createAgent(db, { name: "Mo Murillo" });
    const group = await createGroup(db, { name: "Solo" });
    const medical = await createLineOfBusiness(db, { name: "Group Medical" });
    const carrier = await createCarrier(db, { name: "CaliforniaChoice" });
    await createCommission(db, {
      statementMonth: "2026-08",
      groupId: group.id,
      carrierId: carrier.id,
      lineOfBusinessId: medical.id,
      grossCommissionCents: 1000,
    });
    await expect(previewBulkCompensation(db, {
      effectiveStart: "2026-08",
      mode: "custom",
      people: [{ personKind: "agent", personId: john.id, compensationBps: 10000 }],
      targets: [{ groupId: group.id, lineOfBusinessId: medical.id }],
    })).rejects.toBeInstanceOf(ValidationError);

    await createAgencyCompensationOwner(db, { agentId: mo.id, effectiveStartMonth: "2026-08" });
    await expect(previewBulkCompensation(db, {
      effectiveStart: "2026-08",
      mode: "custom",
      people: [
        { personKind: "agent", personId: mo.id, compensationBps: 5000 },
        { personKind: "agent", personId: mo.id, compensationBps: 5000 },
      ],
      targets: [{ groupId: group.id, lineOfBusinessId: medical.id }],
    })).rejects.toBeInstanceOf(ValidationError);
  });

  it("keeps Joses people terms on Paid Month after a later change", async () => {
    const { db, john, mo, laura, nancy, calChoice, medical, dental, vision, people } = await seed();
    const joses = await createGroup(db, { name: "JOSES ORNAMENTAL SUPPLY INC", primaryAgentId: john.id, accountManagerId: laura.id });
    const rows = [
      { line: dental, cents: -2519 },
      { line: dental, cents: -2519 },
      { line: dental, cents: -2519 },
      { line: dental, cents: -2519 },
      { line: medical, cents: 62076 },
      { line: vision, cents: 936 },
    ];
    for (const row of rows) {
      await createCommission(db, {
        statementMonth: "2026-08",
        groupId: joses.id,
        carrierId: calChoice.id,
        lineOfBusinessId: row.line.id,
        grossCommissionCents: row.cents,
      });
    }
    const preview = await previewBulkCompensation(db, {
      effectiveStart: "2026-08",
      mode: "custom",
      people,
      targets: [
        { groupId: joses.id, lineOfBusinessId: dental.id },
        { groupId: joses.id, lineOfBusinessId: medical.id },
        { groupId: joses.id, lineOfBusinessId: vision.id },
      ],
    });
    await commitBulkCompensation(db, {
      effectiveStart: "2026-08",
      mode: "custom",
      people,
      targets: [
        { groupId: joses.id, lineOfBusinessId: dental.id },
        { groupId: joses.id, lineOfBusinessId: medical.id },
        { groupId: joses.id, lineOfBusinessId: vision.id },
      ],
      previewToken: preview.previewToken,
    });
    const later = await previewBulkCompensation(db, {
      effectiveStart: "2026-09",
      mode: "custom",
      people: [{ personKind: "agent", personId: john.id, compensationBps: 10000 }],
      targets: [
        { groupId: joses.id, lineOfBusinessId: dental.id },
        { groupId: joses.id, lineOfBusinessId: medical.id },
        { groupId: joses.id, lineOfBusinessId: vision.id },
      ],
    });
    await commitBulkCompensation(db, {
      effectiveStart: "2026-09",
      mode: "custom",
      people: [{ personKind: "agent", personId: john.id, compensationBps: 10000 }],
      targets: [
        { groupId: joses.id, lineOfBusinessId: dental.id },
        { groupId: joses.id, lineOfBusinessId: medical.id },
        { groupId: joses.id, lineOfBusinessId: vision.id },
      ],
      previewToken: later.previewToken,
    });
    const commissions = [
      { id: 1, paidMonth: "2026-08", groupId: joses.id, groupName: "JOSES", carrierId: calChoice.id, carrierName: "CaliforniaChoice", lineOfBusinessId: dental.id, lineOfBusinessName: "Group Dental", grossCommissionCents: -2519 },
      { id: 2, paidMonth: "2026-08", groupId: joses.id, groupName: "JOSES", carrierId: calChoice.id, carrierName: "CaliforniaChoice", lineOfBusinessId: dental.id, lineOfBusinessName: "Group Dental", grossCommissionCents: -2519 },
      { id: 3, paidMonth: "2026-08", groupId: joses.id, groupName: "JOSES", carrierId: calChoice.id, carrierName: "CaliforniaChoice", lineOfBusinessId: dental.id, lineOfBusinessName: "Group Dental", grossCommissionCents: -2519 },
      { id: 4, paidMonth: "2026-08", groupId: joses.id, groupName: "JOSES", carrierId: calChoice.id, carrierName: "CaliforniaChoice", lineOfBusinessId: dental.id, lineOfBusinessName: "Group Dental", grossCommissionCents: -2519 },
      { id: 5, paidMonth: "2026-08", groupId: joses.id, groupName: "JOSES", carrierId: calChoice.id, carrierName: "CaliforniaChoice", lineOfBusinessId: medical.id, lineOfBusinessName: "Group Medical", grossCommissionCents: 62076 },
      { id: 6, paidMonth: "2026-08", groupId: joses.id, groupName: "JOSES", carrierId: calChoice.id, carrierName: "CaliforniaChoice", lineOfBusinessId: vision.id, lineOfBusinessName: "Group Vision", grossCommissionCents: 936 },
    ];
    const earnings = evaluateIndividualEarnings({
      commissions,
      allocations: allocationCandidates(await listAllocations(db)),
      teams: (await listTeams(db)).map((team) => ({
        id: team.id,
        name: team.name,
        members: team.members.map((member) => ({
          personKind: member.personKind,
          personId: member.personId,
          name: member.personName,
          shareBps: member.shareBps,
          effectiveStart: member.effectiveStart,
          effectiveEnd: member.effectiveEnd,
          status: member.status,
        })),
      })),
      names: {
        personName: (kind, id) => {
          if (kind === "agent" && id === john.id) return "John";
          if (kind === "agent" && id === mo.id) return "Mo";
          if (kind === "account_manager" && id === laura.id) return "Laura";
          return "Nancy";
        },
      },
      personKind: "agent",
      personId: john.id,
      agencyOwner: { personKind: "agent", personId: mo.id },
    });
    expect(earnings.rows.reduce((sum, row) => sum + row.compensationCents, 0)).toBe(37056);
  });

  it("canonicalizes MED before lock and writes the Group Medical namespace", async () => {
    const { db, people, alpha, medical, med } = await seed();
    const preview = await previewBulkCompensation(db, {
      effectiveStart: "2026-08",
      mode: "custom",
      people,
      targets: [{ groupId: alpha.id, lineOfBusinessId: med.id }],
    });
    expect(preview.targetCount).toBe(1);
    expect(preview.rows[0]?.lineOfBusinessId).toBe(medical.id);
    await commitBulkCompensation(db, {
      effectiveStart: "2026-08",
      mode: "custom",
      people,
      targets: [{ groupId: alpha.id, lineOfBusinessId: med.id }],
      previewToken: preview.previewToken,
    });
    const written = (await listAllocations(db)).filter((row) => row.groupId === alpha.id && row.effectiveStart === "2026-08");
    expect(written).toHaveLength(1);
    expect(written[0]?.lineOfBusinessId).toBe(medical.id);
  });

  it("dedupes MED and MEDHMO on the same Group to one canonical namespace", async () => {
    const { db, people, alpha, medical, med } = await seed();
    const medhmo = await createLineOfBusiness(db, { name: "MEDHMO" });
    const preview = await previewBulkCompensation(db, {
      effectiveStart: "2026-08",
      mode: "custom",
      people,
      targets: [
        { groupId: alpha.id, lineOfBusinessId: med.id },
        { groupId: alpha.id, lineOfBusinessId: medhmo.id },
        { groupId: alpha.id, lineOfBusinessId: medical.id },
      ],
    });
    expect(preview.targetCount).toBe(1);
    const committed = await commitBulkCompensation(db, {
      effectiveStart: "2026-08",
      mode: "custom",
      people,
      targets: [
        { groupId: alpha.id, lineOfBusinessId: med.id },
        { groupId: alpha.id, lineOfBusinessId: medhmo.id },
      ],
      previewToken: preview.previewToken,
    });
    expect(committed.createdCount).toBe(1);
    expect((await listAllocations(db)).filter((row) => row.groupId === alpha.id && row.effectiveStart === "2026-08")).toHaveLength(1);
  });

  it("rejects a raw or canonical sibling change after preview and writes nothing", async () => {
    const { db, john, people, alpha, medical, med } = await seed();
    const preview = await previewBulkCompensation(db, {
      effectiveStart: "2026-08",
      mode: "custom",
      people,
      targets: [{ groupId: alpha.id, lineOfBusinessId: medical.id }],
    });
    await createAllocation(db, {
      groupId: alpha.id,
      lineOfBusinessId: med.id,
      effectiveStart: "2026-08",
      entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }],
    });
    const before = await listAllocations(db);
    await expect(commitBulkCompensation(db, {
      effectiveStart: "2026-08",
      mode: "custom",
      people,
      targets: [{ groupId: alpha.id, lineOfBusinessId: medical.id }],
      previewToken: preview.previewToken,
    })).rejects.toBeInstanceOf(ConflictError);
    expect((await listAllocations(db)).map((row) => row.id)).toEqual(before.map((row) => row.id));

    const second = await previewBulkCompensation(db, {
      effectiveStart: "2026-09",
      mode: "custom",
      people,
      targets: [{ groupId: alpha.id, lineOfBusinessId: medical.id }],
    });
    await createAllocation(db, {
      groupId: alpha.id,
      lineOfBusinessId: medical.id,
      effectiveStart: "2026-09",
      entries: [{ recipientType: "person", personKind: "agent", personId: john.id, compensationBps: 10000 }],
    });
    const beforeCanonical = await listAllocations(db);
    await expect(commitBulkCompensation(db, {
      effectiveStart: "2026-09",
      mode: "custom",
      people,
      targets: [{ groupId: alpha.id, lineOfBusinessId: medical.id }],
      previewToken: second.previewToken,
    })).rejects.toBeInstanceOf(ConflictError);
    expect((await listAllocations(db)).map((row) => `${row.id}:${row.effectiveEnd ?? ""}`))
      .toEqual(beforeCanonical.map((row) => `${row.id}:${row.effectiveEnd ?? ""}`));
  });

  it("rolls back the batch when owner or Team membership changes after preview", async () => {
    const { db, john, laura, people, alpha, beta, medical, dental, team } = await seed();
    const ownerPreview = await previewBulkCompensation(db, {
      effectiveStart: "2026-08",
      mode: "custom",
      people,
      targets: [
        { groupId: alpha.id, lineOfBusinessId: medical.id },
        { groupId: beta.id, lineOfBusinessId: dental.id },
      ],
    });
    const owners = await listAgencyCompensationOwners(db);
    await db.update(agencyCompensationOwners).set({
      agentId: null,
      accountManagerId: laura.id,
      updatedAt: new Date().toISOString(),
    }).where(eq(agencyCompensationOwners.id, owners[0]!.id));
    const beforeOwner = await listAllocations(db);
    await expect(commitBulkCompensation(db, {
      effectiveStart: "2026-08",
      mode: "custom",
      people,
      targets: [
        { groupId: alpha.id, lineOfBusinessId: medical.id },
        { groupId: beta.id, lineOfBusinessId: dental.id },
      ],
      previewToken: ownerPreview.previewToken,
    })).rejects.toBeInstanceOf(ConflictError);
    expect((await listAllocations(db)).map((row) => row.id)).toEqual(beforeOwner.map((row) => row.id));

    const templatePreview = await previewBulkCompensation(db, {
      effectiveStart: "2026-08",
      mode: "template",
      teamId: team.id,
      targets: [{ groupId: alpha.id, lineOfBusinessId: medical.id }],
    });
    await replaceTeamMembers(db, team.id, [
      { personKind: "agent", personId: john.id, shareBps: 10000, effectiveStart: "2026-09" },
    ], { requireComplete: true, closePrior: true });
    const beforeTeam = await listAllocations(db);
    await expect(commitBulkCompensation(db, {
      effectiveStart: "2026-08",
      mode: "template",
      teamId: team.id,
      targets: [{ groupId: alpha.id, lineOfBusinessId: medical.id }],
      previewToken: templatePreview.previewToken,
    })).rejects.toBeInstanceOf(ConflictError);
    expect((await listAllocations(db)).map((row) => row.id)).toEqual(beforeTeam.map((row) => row.id));
  });
});
