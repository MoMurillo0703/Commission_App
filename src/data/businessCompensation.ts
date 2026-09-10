import { AGENCY_OWNER_LABEL, agencyOwnerForPaidMonth, personKey, type PersonIdentity } from "@/domain/agencyOwner";
import {
  agencyOwnerDrilldown,
  classifyCompensationGroups,
  drilldownPayableTotals,
  reconcilePostedCommissions,
  type NamedBusinessPerson,
} from "@/domain/businessCompensation";
import { missingLinesForGroup } from "@/domain/compensationHome";
import { isEligibleAgencyFallback } from "@/domain/compensationFallback";
import { normalizeReportFilters, type ReportFilters } from "@/domain/reports";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { listAccountManagers } from "./accountManagers";
import { listAgents } from "./agents";
import { listAgencyCompensationOwners } from "./agencyOwner";
import { listAllocations } from "./allocations";
import { listCommissions } from "./commissions";
import { listCorrectedCommissionIds } from "./compensationCorrections";
import { listGroups } from "./groups";
import { listGroupLineEvidence } from "./groupLineEvidence";
import { listLinesOfBusiness } from "./linesOfBusiness";
import { listAllPayouts } from "./payouts";

export function namedBusinessPeople(
  agents: Array<{ id: number; name: string }>,
  accountManagers: Array<{ id: number; name: string }>,
  owner: PersonIdentity | null,
): NamedBusinessPerson[] {
  return [
    ...agents.map((agent) => ({ personKind: "agent" as const, personId: agent.id, label: agent.name })),
    ...accountManagers.map((manager) => ({
      personKind: "account_manager" as const,
      personId: manager.id,
      label: manager.name,
    })),
  ].filter((person) => !owner || personKey(person) !== personKey(owner));
}

function commissionInputs(
  commissions: Awaited<ReturnType<typeof listCommissions>>,
  payoutsByCommission: Map<number, Awaited<ReturnType<typeof listAllPayouts>>>,
  corrected: Set<number>,
) {
  return commissions.map((commission) => ({
    id: commission.id,
    paidMonth: commission.statementMonth,
    groupId: commission.groupId,
    carrierId: commission.carrierId,
    lineOfBusinessId: commission.lineOfBusinessId,
    groupName: commission.groupName,
    carrierName: commission.carrierName,
    lineOfBusinessName: commission.lineOfBusinessName,
    grossCommissionCents: commission.grossCommissionCents,
    agentCompensationCents: commission.agentCompensationCents,
    agencyNetCents: commission.agencyNetCents,
    hasPriorCorrection: corrected.has(commission.id),
    payouts: payoutsByCommission.get(commission.id) ?? [],
  }));
}

export async function buildMonthlyCompensationReconciliation(
  db: AppDatabase | undefined,
  filters: string | Pick<ReportFilters, "paidMonth" | "startMonth" | "endMonth" | "ytd" | "groupId" | "carrierId" | "lineOfBusinessId">,
) {
  const database = await resolveDb(db);
  const normalized = typeof filters === "string"
    ? normalizeReportFilters({ kind: "agency", paidMonth: filters })
    : normalizeReportFilters({ kind: "agency", ...filters });
  const paidMonth = normalized.paidMonth ?? "";
  const [commissions, payouts, agents, accountManagers, owners, corrected] = await Promise.all([
    listCommissions(database),
    listAllPayouts(database),
    listAgents(database),
    listAccountManagers(database),
    listAgencyCompensationOwners(database),
    listCorrectedCommissionIds(database),
  ]);
  const ownerForPaidMonth = (month: string) => agencyOwnerForPaidMonth(owners.map((row) => ({
    identity: row.identity,
    effectiveStartMonth: row.effectiveStartMonth,
    effectiveEndMonth: row.effectiveEndMonth,
  })), month);
  const owner = paidMonth ? ownerForPaidMonth(paidMonth) : null;
  const namedPeople = namedBusinessPeople(agents, accountManagers, null);
  const payoutsByCommission = new Map<number, typeof payouts>();
  for (const payout of payouts) {
    const current = payoutsByCommission.get(payout.commissionId) ?? [];
    current.push(payout);
    payoutsByCommission.set(payout.commissionId, current);
  }
  const mapped = commissionInputs(commissions, payoutsByCommission, corrected);
  const reconciliation = reconcilePostedCommissions({
    paidMonth,
    owner,
    namedPeople,
    commissions: mapped,
    filters: normalized,
    ownerForPaidMonth,
  });
  const drilldown = agencyOwnerDrilldown({
    owner,
    commissions: mapped,
    filters: normalized,
    ownerForPaidMonth,
  });
  return {
    owner,
    ownerConfigured: reconciliation.missingOwnerMonths.length === 0 && (paidMonth ? Boolean(owner) || reconciliation.postedCommissionCount === 0 : true),
    ownerLabel: AGENCY_OWNER_LABEL,
    namedPeople: namedBusinessPeople(agents, accountManagers, owner),
    reconciliation,
    drilldown,
    postedCommissionCount: reconciliation.postedCommissionCount,
    headerDetail: drilldownPayableTotals(drilldown),
  };
}

export async function buildAgencyOwnerReport(
  db: AppDatabase | undefined,
  filters: Pick<ReportFilters, "paidMonth" | "startMonth" | "endMonth" | "ytd" | "groupId" | "carrierId" | "lineOfBusinessId">,
) {
  const built = await buildMonthlyCompensationReconciliation(db, filters);
  const paidMonth = built.reconciliation.paidMonth;
  const rows = built.drilldown.flatMap((line) => {
    const parts = [
      line.moDirectCents ? { label: "Mo direct", cents: line.moDirectCents } : null,
      line.moTeamCents ? { label: "Mo team", cents: line.moTeamCents } : null,
      line.agencyRetainedCents ? { label: "Agency retained", cents: line.agencyRetainedCents } : null,
    ].filter((part): part is { label: string; cents: number } => Boolean(part));
    return parts.map((part) => ({
      paidMonth,
      groupId: 0,
      groupName: line.groupName,
      carrierId: 0,
      carrierName: line.carrierName,
      lineOfBusinessId: 0,
      lineOfBusinessName: line.lineOfBusinessName,
      recipientName: `${built.ownerLabel} · ${part.label}`,
      recipientType: part.label,
      personKind: built.owner?.personKind ?? null,
      personId: built.owner?.personId ?? null,
      teamName: part.label === "Mo team" ? "Team" : null,
      grossCommissionCents: line.grossCents,
      allocationBps: line.grossCents ? Math.round((part.cents * 10000) / line.grossCents) : 0,
      compensationCents: part.cents,
    }));
  });
  return {
    ownerConfigured: built.ownerConfigured,
    ownerLabel: built.ownerLabel,
    totals: {
      compensationCents: built.reconciliation.moAgencyCents,
      fallbackAgencyCents: built.reconciliation.fallbackAgencyCents,
      legacyNoPayoutCents: built.reconciliation.legacyNoPayoutCents,
      unresolvedCents: built.reconciliation.unresolvedCents,
      grossCents: built.reconciliation.grossCents,
      differenceCents: built.reconciliation.differenceCents,
    },
    rows,
    reconciliation: built.reconciliation,
    drilldown: built.drilldown,
    headerDetail: built.headerDetail,
  };
}

export type CompensationDirectorySources = {
  groups?: Awaited<ReturnType<typeof listGroups>>;
  allocations?: Awaited<ReturnType<typeof listAllocations>>;
  evidence?: Awaited<ReturnType<typeof listGroupLineEvidence>>;
  lines?: Awaited<ReturnType<typeof listLinesOfBusiness>>;
  commissions?: Awaited<ReturnType<typeof listCommissions>>;
  payouts?: Awaited<ReturnType<typeof listAllPayouts>>;
  corrected?: Awaited<ReturnType<typeof listCorrectedCommissionIds>>;
};

export async function buildCompensationDirectory(db?: AppDatabase, sources: CompensationDirectorySources = {}) {
  const database = await resolveDb(db);
  const [groups, allocations, evidence, lines, commissions, payouts, corrected] = await Promise.all([
    sources.groups ? Promise.resolve(sources.groups) : listGroups(database),
    sources.allocations ? Promise.resolve(sources.allocations) : listAllocations(database),
    sources.evidence ? Promise.resolve(sources.evidence) : listGroupLineEvidence(database),
    sources.lines ? Promise.resolve(sources.lines) : listLinesOfBusiness(database),
    sources.commissions ? Promise.resolve(sources.commissions) : listCommissions(database),
    sources.payouts ? Promise.resolve(sources.payouts) : listAllPayouts(database),
    sources.corrected ? Promise.resolve(sources.corrected) : listCorrectedCommissionIds(database),
  ]);
  const payoutsByCommission = new Map<number, typeof payouts>();
  for (const payout of payouts) {
    const current = payoutsByCommission.get(payout.commissionId) ?? [];
    current.push(payout);
    payoutsByCommission.set(payout.commissionId, current);
  }
  const exceptionGroupIds = [...new Set(commissions.flatMap((commission) => (
    isEligibleAgencyFallback({
      commissionId: commission.id,
      grossCommissionCents: commission.grossCommissionCents,
      agentCompensationCents: commission.agentCompensationCents,
      agencyNetCents: commission.agencyNetCents,
      payouts: payoutsByCommission.get(commission.id) ?? [],
      hasPriorCorrection: corrected.has(commission.id),
    }) ? [commission.groupId] : []
  )))];
  const missingLineCounts = Object.fromEntries(groups.map((group) => [
    group.id,
    missingLinesForGroup(group.id, evidence, lines, allocations).length,
  ]));
  return classifyCompensationGroups({
    groups,
    summaries: groups.map((group) => {
      const active = allocations.filter((row) => row.groupId === group.id && row.status === "active");
      return {
        groupId: group.id,
        groupName: group.name,
        activeAllocationCount: active.length,
        currentLineNames: [...new Set(active.map((row) => row.lineOfBusinessName))],
      };
    }),
    missingLineCounts,
    exceptionGroupIds,
  });
}
