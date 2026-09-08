import { AGENCY_OWNER_LABEL, personKey, type PersonIdentity } from "@/domain/agencyOwner";
import {
  agencyOwnerDrilldown,
  classifyCompensationGroups,
  reconcilePostedCommissions,
  type NamedBusinessPerson,
} from "@/domain/businessCompensation";
import { missingLinesForGroup } from "@/domain/compensationHome";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { listAccountManagers } from "./accountManagers";
import { listAgents } from "./agents";
import { resolveAgencyOwnerIdentity } from "./agencyOwner";
import { listAllocations } from "./allocations";
import { listCommissions } from "./commissions";
import { listCorrectedCommissionIds } from "./compensationCorrections";
import { isEligibleAgencyFallback } from "@/domain/compensationFallback";
import { listGroups } from "./groups";
import { listGroupLineEvidence } from "./groupLineEvidence";
import { listLinesOfBusiness } from "./linesOfBusiness";
import { listAllPayouts } from "./payouts";
import { listTeams } from "./teams";

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

export async function buildMonthlyCompensationReconciliation(
  db: AppDatabase | undefined,
  paidMonth: string,
) {
  const database = await resolveDb(db);
  const [commissions, payouts, agents, accountManagers] = await Promise.all([
    listCommissions(database),
    listAllPayouts(database),
    listAgents(database),
    listAccountManagers(database),
  ]);
  const owner = resolveAgencyOwnerIdentity();
  const namedPeople = namedBusinessPeople(agents, accountManagers, owner);
  const payoutsByCommission = new Map<number, typeof payouts>();
  for (const payout of payouts) {
    const current = payoutsByCommission.get(payout.commissionId) ?? [];
    current.push(payout);
    payoutsByCommission.set(payout.commissionId, current);
  }
  const monthCommissions = commissions.filter((row) => row.statementMonth === paidMonth);
  const reconciliation = reconcilePostedCommissions({
    paidMonth,
    owner,
    namedPeople,
    commissions: monthCommissions.map((commission) => ({
      id: commission.id,
      paidMonth: commission.statementMonth,
      grossCommissionCents: commission.grossCommissionCents,
      payouts: payoutsByCommission.get(commission.id) ?? [],
    })),
  });
  const drilldown = agencyOwnerDrilldown({
    owner,
    commissions: monthCommissions.map((commission) => ({
      paidMonth: commission.statementMonth,
      carrierName: commission.carrierName,
      groupName: commission.groupName,
      lineOfBusinessName: commission.lineOfBusinessName,
      grossCommissionCents: commission.grossCommissionCents,
      payouts: payoutsByCommission.get(commission.id) ?? [],
    })),
  });
  return {
    owner,
    ownerLabel: AGENCY_OWNER_LABEL,
    namedPeople,
    reconciliation,
    drilldown,
    postedCommissionCount: monthCommissions.length,
  };
}

export async function buildAgencyOwnerReport(db: AppDatabase | undefined, paidMonth: string) {
  const built = await buildMonthlyCompensationReconciliation(db, paidMonth);
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
    ownerConfigured: Boolean(built.owner),
    ownerLabel: built.ownerLabel,
    totals: {
      compensationCents: built.reconciliation.moAgencyCents,
      fallbackAgencyCents: built.reconciliation.fallbackAgencyCents,
      unresolvedCents: built.reconciliation.unresolvedCents,
      grossCents: built.reconciliation.grossCents,
    },
    rows,
    reconciliation: built.reconciliation,
    drilldown: built.drilldown,
  };
}

export async function buildCompensationDirectory(db?: AppDatabase) {
  const database = await resolveDb(db);
  const [groups, allocations, evidence, lines, commissions, payouts, corrected] = await Promise.all([
    listGroups(database),
    listAllocations(database),
    listGroupLineEvidence(database),
    listLinesOfBusiness(database),
    listCommissions(database),
    listAllPayouts(database),
    listCorrectedCommissionIds(database),
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
