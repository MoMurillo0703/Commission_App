import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { currentPaidMonth, paidMonthRangesOverlap } from "@/domain/dates";
import { personKey } from "@/domain/agencyOwner";
import { buildPeopleDirectory, type PersonDirectoryEntry } from "@/domain/peopleDirectory";
import { personCompensationRows } from "@/domain/personCompensation";
import { reportsHref } from "@/domain/reportDeepLink";
import { listAccountManagers, getAccountManager } from "./accountManagers";
import { getAgencyOwnerForPaidMonth } from "./agencyOwner";
import { listAgents, getAgent } from "./agents";
import { listAllocations } from "./allocations";
import { listGroups } from "./groups";
import { listTeams } from "./teams";
import { NotFoundError } from "@/lib/errors";

function activeTeamCountByPerson(
  teams: Awaited<ReturnType<typeof listTeams>>,
  asOfMonth: string,
) {
  const counts = new Map<string, number>();
  for (const team of teams) {
    if (team.status !== "active") continue;
    const seen = new Set<string>();
    for (const member of team.members) {
      if (member.status !== "active") continue;
      if (!paidMonthRangesOverlap(asOfMonth, asOfMonth, member.effectiveStart, member.effectiveEnd)) continue;
      const key = personKey({ personKind: member.personKind, personId: member.personId });
      if (seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return Object.fromEntries(counts);
}

export async function loadPeopleDirectory(db?: AppDatabase): Promise<{
  asOfMonth: string;
  people: PersonDirectoryEntry[];
}> {
  const database = await resolveDb(db);
  const asOfMonth = currentPaidMonth();
  const agents = await listAgents(database);
  const accountManagers = await listAccountManagers(database);
  const groups = await listGroups(database);
  const teams = await listTeams(database);
  return {
    asOfMonth,
    people: buildPeopleDirectory({
      agents,
      accountManagers,
      groups,
      activeTeamCountByPerson: activeTeamCountByPerson(teams, asOfMonth),
    }),
  };
}

export async function loadPersonWorkspace(
  db: AppDatabase | undefined,
  personKind: "agent" | "account_manager",
  personId: number,
) {
  const database = await resolveDb(db);
  const asOfMonth = currentPaidMonth();
  const person = personKind === "agent"
    ? await getAgent(database, personId)
    : await getAccountManager(database, personId);
  if (!person) throw new NotFoundError("Person not found.");
  const groups = await listGroups(database);
  const allocations = await listAllocations(database);
  const teams = await listTeams(database);
  const agents = await listAgents(database);
  const accountManagers = await listAccountManagers(database);
  const agencyOwner = await getAgencyOwnerForPaidMonth(database, asOfMonth);
  const directory = buildPeopleDirectory({
    agents,
    accountManagers,
    groups,
    activeTeamCountByPerson: activeTeamCountByPerson(teams, asOfMonth),
  });
  const entry = directory.find((item) => (
    personKind === "agent" ? item.agentId === personId : item.accountManagerId === personId
  ));
  const primaryAgentFor = groups.filter((group) => personKind === "agent" && group.primaryAgentId === personId);
  const accountManagerFor = groups.filter((group) => personKind === "account_manager" && group.accountManagerId === personId);
  const personTeams = teams.filter((team) => team.members.some((member) => (
    member.personKind === personKind
    && member.personId === personId
    && member.status === "active"
    && paidMonthRangesOverlap(asOfMonth, asOfMonth, member.effectiveStart, member.effectiveEnd)
  )));
  const isAgencyOwner = agencyOwner?.personKind === personKind && agencyOwner.personId === personId;
  return {
    asOfMonth,
    person,
    personKind,
    entry,
    primaryAgentFor,
    accountManagerFor,
    teams: personTeams,
    compensation: personCompensationRows({
      allocations,
      teams,
      personKind,
      personId,
    }),
    isAgencyOwner,
    earningsHref: reportsHref({
      person: { personKind, personId },
      paidMonth: asOfMonth,
    }),
    agencyReportHref: isAgencyOwner
      ? reportsHref({ agencyOwner: true, paidMonth: asOfMonth })
      : null,
  };
}
