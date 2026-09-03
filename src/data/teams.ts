import { desc, eq } from "drizzle-orm";
import { isPaidMonth, paidMonthInRange, paidMonthRangesOverlap, previousPaidMonth } from "@/domain/dates";
import { validateTeamMemberShares, type PersonKind } from "@/domain/allocations";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { teamMemberships, teams } from "@/db/schema";
import { getAccountManager } from "./accountManagers";
import { getAgent } from "./agents";
import { isUniqueConstraintError, NotFoundError, ValidationError } from "@/lib/errors";

export type TeamStatus = "active" | "inactive";

export type TeamMemberWrite = {
  personKind: PersonKind;
  personId: number;
  shareBps: number;
  effectiveStart: string;
  effectiveEnd?: string | null;
  status?: TeamStatus;
};

export type TeamWrite = {
  name: string;
  status?: TeamStatus;
  members?: TeamMemberWrite[];
};

export type TeamMemberView = {
  id: number;
  teamId: number;
  personKind: PersonKind;
  personId: number;
  personName: string;
  shareBps: number;
  effectiveStart: string;
  effectiveEnd: string | null;
  status: TeamStatus;
};

export type TeamView = {
  id: number;
  name: string;
  status: TeamStatus;
  members: TeamMemberView[];
  createdAt: string;
  updatedAt: string;
};

function asStatus(value: string): TeamStatus {
  return value === "inactive" ? "inactive" : "active";
}

async function personName(db: AppDatabase, kind: PersonKind, id: number) {
  if (kind === "agent") {
    const agent = await getAgent(db, id);
    if (!agent) throw new NotFoundError("Person not found.");
    return agent.name;
  }
  const manager = await getAccountManager(db, id);
  if (!manager) throw new NotFoundError("Person not found.");
  return manager.name;
}

async function assertPerson(db: AppDatabase, kind: PersonKind, id: number) {
  return personName(db, kind, id);
}

function normalizePeriod(start: string, end: string | null | undefined) {
  if (!isPaidMonth(start)) throw new ValidationError("Effective start must be a month in YYYY-MM format.");
  const effectiveEnd = end ?? null;
  if (effectiveEnd != null && !isPaidMonth(effectiveEnd)) {
    throw new ValidationError("Effective end must be a month in YYYY-MM format.");
  }
  if (effectiveEnd != null && effectiveEnd < start) {
    throw new ValidationError("Effective end cannot be before the start month.");
  }
  return { effectiveStart: start, effectiveEnd };
}

export async function listTeams(db?: AppDatabase): Promise<TeamView[]> {
  const database = await resolveDb(db);
  const teamRows = await database.select().from(teams).orderBy(teams.name);
  const membershipRows = await database.select().from(teamMemberships).orderBy(desc(teamMemberships.effectiveStart), teamMemberships.id);
  return Promise.all(teamRows.map(async (team) => ({
    id: team.id,
    name: team.name,
    status: asStatus(team.status),
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
    members: await Promise.all(
      membershipRows
        .filter((member) => member.teamId === team.id)
        .map(async (member) => ({
          id: member.id,
          teamId: member.teamId,
          personKind: member.personKind as PersonKind,
          personId: member.personId,
          personName: await personName(database, member.personKind as PersonKind, member.personId),
          shareBps: member.shareBps,
          effectiveStart: member.effectiveStart,
          effectiveEnd: member.effectiveEnd,
          status: asStatus(member.status),
        })),
    ),
  })));
}

export async function getTeam(db: AppDatabase | undefined, id: number) {
  return (await listTeams(db)).find((team) => team.id === id) ?? null;
}

export function currentTeamMembers(team: TeamView, paidMonth: string) {
  return team.members.filter((member) => (
    member.status === "active"
    && paidMonthInRange(paidMonth, member.effectiveStart, member.effectiveEnd)
  ));
}

export async function createTeam(db: AppDatabase | undefined, input: TeamWrite) {
  const database = await resolveDb(db);
  const now = new Date().toISOString();
  try {
    const [row] = await database.insert(teams).values({
      name: input.name.trim(),
      status: input.status ?? "active",
      createdAt: now,
      updatedAt: now,
    }).returning();
    if (input.members?.length) {
      await replaceTeamMembers(database, row.id, input.members, { requireComplete: true });
    }
    return (await getTeam(database, row.id))!;
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new ValidationError("A team with this name already exists.");
    throw error;
  }
}

export async function updateTeam(db: AppDatabase | undefined, id: number, input: { name?: string; status?: TeamStatus }) {
  const database = await resolveDb(db);
  if (!await getTeam(database, id)) throw new NotFoundError("Team not found.");
  try {
    await database.update(teams).set({
      ...(input.name != null ? { name: input.name.trim() } : {}),
      ...(input.status != null ? { status: input.status } : {}),
      updatedAt: new Date().toISOString(),
    }).where(eq(teams.id, id));
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new ValidationError("A team with this name already exists.");
    throw error;
  }
  return (await getTeam(database, id))!;
}

export async function replaceTeamMembers(
  db: AppDatabase | undefined,
  teamId: number,
  members: TeamMemberWrite[],
  options: { requireComplete?: boolean; closePrior?: boolean } = {},
) {
  const database = await resolveDb(db);
  const team = await getTeam(database, teamId);
  if (!team) throw new NotFoundError("Team not found.");
  if (options.requireComplete !== false) {
    try {
      validateTeamMemberShares(members);
    } catch (error) {
      throw new ValidationError(error instanceof Error ? error.message : "Team member splits must total 100 percent.");
    }
  }
  if (members.some((member) => (member.status ?? "active") !== "active")) {
    throw new ValidationError("A Team composition must contain active members totaling exactly 100 percent.");
  }
  const periodKeys = new Set(members.map((member) => `${member.effectiveStart}:${member.effectiveEnd ?? ""}`));
  if (periodKeys.size > 1) {
    throw new ValidationError("All members in a Team composition must use the same effective period.");
  }
  for (const member of members) {
    await assertPerson(database, member.personKind, member.personId);
    normalizePeriod(member.effectiveStart, member.effectiveEnd);
  }
  const now = new Date().toISOString();
  const start = members[0] ? normalizePeriod(members[0].effectiveStart, members[0].effectiveEnd).effectiveStart : null;
  await database.transaction(async (tx) => {
    if (options.closePrior !== false && start) {
      for (const prior of team.members.filter((member) => (
        member.status === "active"
        && paidMonthRangesOverlap(member.effectiveStart, member.effectiveEnd, start, null)
      ))) {
        if (prior.effectiveStart >= start) {
          throw new ValidationError("An active team membership already exists for this period.");
        }
        const closeEnd = previousPaidMonth(start);
        if (closeEnd < prior.effectiveStart) {
          throw new ValidationError("The new start month overlaps the existing team membership start.");
        }
        await tx.update(teamMemberships)
          .set({ effectiveEnd: closeEnd, updatedAt: now })
          .where(eq(teamMemberships.id, prior.id));
      }
    }
    for (const member of members) {
      const period = normalizePeriod(member.effectiveStart, member.effectiveEnd);
      await tx.insert(teamMemberships).values({
        teamId,
        personKind: member.personKind,
        personId: member.personId,
        shareBps: member.shareBps,
        effectiveStart: period.effectiveStart,
        effectiveEnd: period.effectiveEnd,
        status: member.status ?? "active",
        createdAt: now,
        updatedAt: now,
      });
    }
    await tx.update(teams).set({ updatedAt: now }).where(eq(teams.id, teamId));
  });
  return (await getTeam(database, teamId))!;
}
