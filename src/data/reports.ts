import { and, eq, gte, lte } from "drizzle-orm";
import { reportAvailabilityFromMonths } from "@/domain/reportDiscovery";
import {
  monthInReportRange,
  normalizeReportFilters,
  sumAgencyReport,
  sumIndividualReport,
  sumTeamReport,
  type AgencyReportRow,
  type IndividualReportRow,
  type ReportFilters,
  type TeamReportRow,
} from "@/domain/reports";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { agents, carriers, commissionRecords, groups, linesOfBusiness } from "@/db/schema";
import { compensationReviewHref } from "@/domain/compensationExceptions";
import { currentEarningsReadiness, evaluateIndividualEarnings, projectTeamEarnings } from "@/domain/currentEarnings";
import type { UnallocatedPostedCommission } from "@/domain/recipientStatement";
import { agencyExecutiveSummary } from "@/domain/reportPresentation";
import { allocationCandidates, listAllocations } from "./allocations";
import { buildMonthlyCompensationReconciliation } from "./businessCompensation";
import { listTeams, type TeamView } from "./teams";
import { getAccountManager, listAccountManagers } from "./accountManagers";
import { getAgent, listAgents } from "./agents";
import { getCarrier } from "./carriers";
import { getGroup } from "./groups";
import { getLineOfBusiness } from "./linesOfBusiness";
import { getTeam } from "./teams";

export type ReportNameLookup = {
  groupName?: string | null;
  carrierName?: string | null;
  lineName?: string | null;
  personName?: string | null;
  teamName?: string | null;
  accountManagerName?: string | null;
  primaryAgentName?: string | null;
};

async function postedCommissions(db: AppDatabase, filters: ReportFilters) {
  const clauses = [];
  if (filters.startMonth) clauses.push(gte(commissionRecords.statementMonth, filters.startMonth));
  if (filters.endMonth) clauses.push(lte(commissionRecords.statementMonth, filters.endMonth));
  if (filters.groupId) clauses.push(eq(commissionRecords.groupId, filters.groupId));
  if (filters.carrierId) clauses.push(eq(commissionRecords.carrierId, filters.carrierId));
  if (filters.lineOfBusinessId) clauses.push(eq(commissionRecords.lineOfBusinessId, filters.lineOfBusinessId));
  const rows = await db
    .select({
      id: commissionRecords.id,
      paidMonth: commissionRecords.statementMonth,
      groupId: commissionRecords.groupId,
      groupName: groups.name,
      accountManagerId: groups.accountManagerId,
      primaryAgentId: groups.primaryAgentId,
      carrierId: commissionRecords.carrierId,
      carrierName: carriers.name,
      lineOfBusinessId: commissionRecords.lineOfBusinessId,
      lineOfBusinessName: linesOfBusiness.name,
      agentId: commissionRecords.agentId,
      agentName: agents.name,
      premiumCents: commissionRecords.premiumCents,
      premiumMonth: commissionRecords.premiumMonth,
      sourcePeriodLabel: commissionRecords.sourcePeriodLabel,
      importStatementId: commissionRecords.importStatementId,
      grossCommissionCents: commissionRecords.grossCommissionCents,
      compensationDistributedCents: commissionRecords.agentCompensationCents,
      agencyNetCents: commissionRecords.agencyNetCents,
    })
    .from(commissionRecords)
    .innerJoin(groups, eq(commissionRecords.groupId, groups.id))
    .innerJoin(carriers, eq(commissionRecords.carrierId, carriers.id))
    .innerJoin(linesOfBusiness, eq(commissionRecords.lineOfBusinessId, linesOfBusiness.id))
    .leftJoin(agents, eq(commissionRecords.agentId, agents.id))
    .where(clauses.length ? and(...clauses) : undefined);
  return rows.filter((row) => {
    if (!monthInReportRange(row.paidMonth, filters)) return false;
    if (filters.accountManagerId && row.accountManagerId !== filters.accountManagerId) return false;
    if (filters.primaryAgentId && row.primaryAgentId !== filters.primaryAgentId) return false;
    return true;
  });
}

export async function reportNameLookup(db: AppDatabase | undefined, filters: ReportFilters): Promise<ReportNameLookup> {
  const database = await resolveDb(db);
  return {
    groupName: filters.groupId ? (await getGroup(database, filters.groupId))?.name ?? null : null,
    carrierName: filters.carrierId ? (await getCarrier(database, filters.carrierId))?.name ?? null : null,
    lineName: filters.lineOfBusinessId ? (await getLineOfBusiness(database, filters.lineOfBusinessId))?.name ?? null : null,
    personName: filters.personId && filters.personKind
      ? filters.personKind === "agent"
        ? (await getAgent(database, filters.personId))?.name ?? null
        : (await getAccountManager(database, filters.personId))?.name ?? null
      : null,
    teamName: filters.teamId ? (await getTeam(database, filters.teamId))?.name ?? null : null,
    accountManagerName: filters.accountManagerId ? (await getAccountManager(database, filters.accountManagerId))?.name ?? null : null,
    primaryAgentName: filters.primaryAgentId ? (await getAgent(database, filters.primaryAgentId))?.name ?? null : null,
  };
}

export async function reportAvailability(db: AppDatabase | undefined, matchingRowCount = 0) {
  const database = await resolveDb(db);
  const rows = await database.select({ paidMonth: commissionRecords.statementMonth }).from(commissionRecords);
  return reportAvailabilityFromMonths(rows.map((row) => row.paidMonth), matchingRowCount);
}

export async function buildAgencyReport(db: AppDatabase | undefined, input: ReportFilters) {
  const database = await resolveDb(db);
  const filters = normalizeReportFilters(input);
  const rows: AgencyReportRow[] = (await postedCommissions(database, filters)).map((row) => ({
    paidMonth: row.paidMonth,
    coverageMonth: row.premiumMonth,
    sourcePeriodLabel: row.sourcePeriodLabel,
    groupId: row.groupId,
    groupName: row.groupName,
    carrierId: row.carrierId,
    carrierName: row.carrierName,
    lineOfBusinessId: row.lineOfBusinessId,
    lineOfBusinessName: row.lineOfBusinessName,
    premiumCents: row.premiumCents,
    grossCommissionCents: row.grossCommissionCents,
    compensationDistributedCents: row.compensationDistributedCents,
    agencyNetCents: row.agencyNetCents,
  }));
  const reconciliation = await buildMonthlyCompensationReconciliation(database, filters);
  const executive = agencyExecutiveSummary(
    rows,
    reconciliation.reconciliation.payableReady,
    reconciliation.reconciliation.payableReadyMessage,
  );
  return {
    filters,
    names: await reportNameLookup(database, filters),
    rows,
    totals: sumAgencyReport(rows),
    availability: await reportAvailability(database, rows.length),
    executive,
    payable: {
      payableReady: executive.payableReady,
      message: executive.payableReady ? null : executive.payableStatus,
    },
  };
}

function personNameLookup(
  agents: Array<{ id: number; name: string }>,
  managers: Array<{ id: number; name: string }>,
) {
  const names = new Map<string, string>();
  for (const agent of agents) names.set(`agent:${agent.id}`, agent.name);
  for (const manager of managers) names.set(`account_manager:${manager.id}`, manager.name);
  return (kind: "agent" | "account_manager", id: number) => names.get(`${kind}:${id}`) ?? "Person";
}

function earningsTeams(teams: TeamView[]) {
  return teams.map((team) => ({
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
  }));
}

export async function buildIndividualReport(db: AppDatabase | undefined, input: ReportFilters) {
  const database = await resolveDb(db);
  const filters = normalizeReportFilters({ ...input, kind: input.kind === "recipient" ? "recipient" : "individual" });
  const commissions = await postedCommissions(database, filters);
  const [agents, managers, allocations, teams] = await Promise.all([
    listAgents(database),
    listAccountManagers(database),
    listAllocations(database),
    listTeams(database),
  ]);
  const evaluation = evaluateIndividualEarnings({
    commissions,
    allocations: allocationCandidates(allocations),
    teams: earningsTeams(teams),
    names: { personName: personNameLookup(agents, managers) },
    personKind: filters.personKind,
    personId: filters.personId,
    teamId: filters.teamId,
  });
  const rows = evaluation.rows;
  const readiness = currentEarningsReadiness({
    matchingCommissionCount: commissions.length,
    outcomes: evaluation.outcomes,
    recipientRowCount: rows.filter((row) => !row.reviewRequired).length,
  });
  const paidMonth = filters.paidMonth ?? evaluation.outcomes[0]?.paidMonth ?? "";
  const names = await reportNameLookup(database, filters);
  return {
    filters,
    names,
    rows,
    totals: sumIndividualReport(rows),
    availability: await reportAvailability(database, rows.length),
    payable: {
      payableReady: readiness.payableReady,
      unallocated: [] as UnallocatedPostedCommission[],
      message: readiness.message,
      reviewHref: readiness.reviewCommissionIds.length && paidMonth
        ? compensationReviewHref({
          paidMonth,
          commissionIds: readiness.reviewCommissionIds,
          personKind: filters.personKind,
          personId: filters.personId,
          personName: names.personName,
        })
        : null,
    },
    readiness,
    matchingCommissionCount: commissions.length,
  };
}

export async function buildTeamReport(db: AppDatabase | undefined, input: ReportFilters) {
  const database = await resolveDb(db);
  const filters = normalizeReportFilters({ ...input, kind: "team" });
  const commissions = await postedCommissions(database, filters);
  const [agents, managers, allocations, teams] = await Promise.all([
    listAgents(database),
    listAccountManagers(database),
    listAllocations(database),
    listTeams(database),
  ]);
  const rows: TeamReportRow[] = projectTeamEarnings({
    commissions,
    allocations: allocationCandidates(allocations),
    teams: earningsTeams(teams),
    names: { personName: personNameLookup(agents, managers) },
    teamId: filters.teamId,
  });
  return {
    filters,
    names: await reportNameLookup(database, filters),
    rows,
    totals: sumTeamReport(rows),
    availability: await reportAvailability(database, rows.length),
  };
}
