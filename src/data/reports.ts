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
import { recipientPayableReadiness } from "@/domain/recipientStatement";
import { listAllPayouts } from "./payouts";
import { getAccountManager } from "./accountManagers";
import { getAgent } from "./agents";
import { getCarrier } from "./carriers";
import { getGroup, listGroups } from "./groups";
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
  return {
    filters,
    names: await reportNameLookup(database, filters),
    rows,
    totals: sumAgencyReport(rows),
    availability: await reportAvailability(database, rows.length),
  };
}

export async function buildIndividualReport(db: AppDatabase | undefined, input: ReportFilters) {
  const database = await resolveDb(db);
  const filters = normalizeReportFilters({ ...input, kind: input.kind === "recipient" ? "recipient" : "individual" });
  const commissions = await postedCommissions(database, filters);
  const payouts = await listAllPayouts(database);
  const byCommission = new Map(commissions.map((row) => [row.id, row]));
  const rows: IndividualReportRow[] = [];
  for (const payout of payouts) {
    if (payout.recipientType !== "person" && payout.recipientType !== "team_member") continue;
    const commission = byCommission.get(payout.commissionId);
    if (!commission) continue;
    if (filters.personKind && payout.personKind !== filters.personKind) continue;
    if (filters.personId && payout.personId !== filters.personId) continue;
    if (filters.teamId && payout.teamId !== filters.teamId) continue;
    rows.push({
      paidMonth: commission.paidMonth,
      groupId: commission.groupId,
      groupName: commission.groupName,
      carrierId: commission.carrierId,
      carrierName: commission.carrierName,
      lineOfBusinessId: commission.lineOfBusinessId,
      lineOfBusinessName: commission.lineOfBusinessName,
      recipientName: payout.personName ?? "Person",
      personKind: payout.personKind,
      personId: payout.personId,
      teamName: payout.teamName,
      grossCommissionCents: commission.grossCommissionCents,
      allocationBps: payout.allocationBps,
      compensationCents: payout.compensationCents,
      commissionId: commission.id,
      allocationId: payout.allocationId,
      premiumCents: commission.premiumCents,
      importStatementId: commission.importStatementId,
    });
  }
  const groups = await listGroups(database);
  const assignedGroupIds = groups
    .filter((group) => (
      (filters.personKind === "agent" && group.primaryAgentId === filters.personId)
      || (filters.personKind === "account_manager" && group.accountManagerId === filters.personId)
    ))
    .map((group) => group.id);
  const commissionsWithAllocation = new Set(
    payouts.filter((payout) => payout.allocationId != null).map((payout) => payout.commissionId),
  );
  const payable = recipientPayableReadiness({
    assignedGroupIds,
    postedCommissions: commissions.map((commission) => ({
      id: commission.id,
      groupId: commission.groupId,
      groupName: commission.groupName,
      lineOfBusinessName: commission.lineOfBusinessName,
      paidMonth: commission.paidMonth,
      grossCommissionCents: commission.grossCommissionCents,
      hasAllocation: commissionsWithAllocation.has(commission.id),
    })),
  });
  return {
    filters,
    names: await reportNameLookup(database, filters),
    rows,
    totals: sumIndividualReport(rows),
    availability: await reportAvailability(database, rows.length),
    payable,
    matchingCommissionCount: commissions.length,
  };
}

export async function buildTeamReport(db: AppDatabase | undefined, input: ReportFilters) {
  const database = await resolveDb(db);
  const filters = normalizeReportFilters({ ...input, kind: "team" });
  const commissions = await postedCommissions(database, filters);
  const payouts = await listAllPayouts(database);
  const byCommission = new Map(commissions.map((row) => [row.id, row]));
  const teamParents = payouts.filter((payout) => payout.recipientType === "team" && (!filters.teamId || payout.teamId === filters.teamId));
  const rows: TeamReportRow[] = [];
  for (const team of teamParents) {
    const commission = byCommission.get(team.commissionId);
    if (!commission) continue;
    const members = payouts.filter((payout) => payout.parentPayoutId === team.id);
    if (members.length === 0) {
      rows.push({
        snapshotKey: `${commission.id}:${team.id}`,
        paidMonth: commission.paidMonth,
        teamId: team.teamId ?? 0,
        teamName: team.teamName ?? "Team",
        groupId: commission.groupId,
        groupName: commission.groupName,
        lineOfBusinessId: commission.lineOfBusinessId,
        lineOfBusinessName: commission.lineOfBusinessName,
        grossCommissionCents: commission.grossCommissionCents,
        teamAllocationBps: team.allocationBps,
        teamCompensationCents: team.compensationCents,
        memberName: "—",
        memberCompensationCents: 0,
        memberAllocationBps: 0,
      });
      continue;
    }
    for (const member of members) {
      rows.push({
        snapshotKey: `${commission.id}:${team.id}`,
        paidMonth: commission.paidMonth,
        teamId: team.teamId ?? 0,
        teamName: team.teamName ?? "Team",
        groupId: commission.groupId,
        groupName: commission.groupName,
        lineOfBusinessId: commission.lineOfBusinessId,
        lineOfBusinessName: commission.lineOfBusinessName,
        grossCommissionCents: commission.grossCommissionCents,
        teamAllocationBps: team.allocationBps,
        teamCompensationCents: team.compensationCents,
        memberName: member.personName ?? "Member",
        memberCompensationCents: member.compensationCents,
        memberAllocationBps: member.allocationBps,
      });
    }
  }
  return {
    filters,
    names: await reportNameLookup(database, filters),
    rows,
    totals: sumTeamReport(rows),
    availability: await reportAvailability(database, rows.length),
  };
}
