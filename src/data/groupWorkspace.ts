import { inArray } from "drizzle-orm";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { importStatements } from "@/db/schema";
import { currentPaidMonth } from "@/domain/dates";
import { classifyGroupLobCompensation, rollupGroupCompensationStatus } from "@/domain/groupCompensationStatus";
import { linesForGroupSelection } from "@/domain/activeGroupLines";
import type { GroupDirectoryRow } from "@/domain/groupDirectory";
import { listAccountManagers } from "./accountManagers";
import { listAgents } from "./agents";
import { listAllocations, type AllocationView } from "./allocations";
import { listCarriers } from "./carriers";
import { listCarrierGroupIdentities } from "./carrierGroupIdentities";
import { listCommissionGroupCarriers, listCommissionGroupLines, listGroupCommissions, type CommissionView } from "./commissions";
import { getGroup, listGroups } from "./groups";
import { listLinesOfBusiness } from "./linesOfBusiness";
import { listTeams } from "./teams";
import { NotFoundError } from "@/lib/errors";

const GROUP_COMMISSION_LIMIT = 100;

export type GroupWorkspaceLookups = {
  agents: Awaited<ReturnType<typeof listAgents>>;
  accountManagers: Awaited<ReturnType<typeof listAccountManagers>>;
  carriers: Awaited<ReturnType<typeof listCarriers>>;
  linesOfBusiness: Awaited<ReturnType<typeof listLinesOfBusiness>>;
  teams: Awaited<ReturnType<typeof listTeams>>;
};

export type GroupCompensationLineView = {
  lineOfBusinessId: number;
  name: string;
  kind: ReturnType<typeof classifyGroupLobCompensation>["kind"];
  label: string;
  statusLabel: string;
  recipientSummary: string;
  configured: boolean;
  invalid: boolean;
  setupOpportunity: boolean;
  current: ReturnType<typeof classifyGroupLobCompensation>["current"];
  future: ReturnType<typeof classifyGroupLobCompensation>["future"];
  historical: ReturnType<typeof classifyGroupLobCompensation>["historical"];
};

export type GroupCommissionRow = CommissionView & {
  statementName: string | null;
};

function allocationViewsForPair(allocations: AllocationView[], groupId: number, lineOfBusinessId: number) {
  return allocations
    .filter((row) => row.groupId === groupId && row.lineOfBusinessId === lineOfBusinessId)
    .map((row) => ({
      id: row.id,
      status: row.status,
      effectiveStart: row.effectiveStart,
      effectiveEnd: row.effectiveEnd,
      entries: row.entries.map((entry) => ({
        recipientType: entry.recipientType,
        personKind: entry.personKind,
        personId: entry.personId,
        teamId: entry.teamId,
        personName: entry.personName,
        teamName: entry.teamName,
        compensationBps: entry.compensationBps,
      })),
    }));
}

export function groupCompensationLinesFor(
  groupId: number,
  lines: Array<{ id: number; name: string }>,
  evidence: Array<{ groupId: number; lineOfBusinessId: number }>,
  allocations: AllocationView[],
  asOfMonth: string,
): GroupCompensationLineView[] {
  return linesForGroupSelection(groupId, lines, evidence).map((line) => {
    const classified = classifyGroupLobCompensation({
      asOfMonth,
      allocations: allocationViewsForPair(allocations, groupId, line.id),
    });
    return {
      lineOfBusinessId: line.id,
      name: line.name,
      ...classified,
    };
  });
}

export async function loadGroupDirectory(db?: AppDatabase): Promise<{
  asOfMonth: string;
  rows: GroupDirectoryRow[];
  allocations: AllocationView[];
  lookups: Omit<GroupWorkspaceLookups, "teams">;
}> {
  const database = await resolveDb(db);
  const asOfMonth = currentPaidMonth();
  const groups = await listGroups(database);
  const agents = await listAgents(database);
  const accountManagers = await listAccountManagers(database);
  const carriers = await listCarriers(database);
  const linesOfBusiness = await listLinesOfBusiness(database);
  const identities = await listCarrierGroupIdentities(database);
  const commissionCarriers = await listCommissionGroupCarriers(database);
  const commissionLines = await listCommissionGroupLines(database);
  const allocations = await listAllocations(database);

  const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));
  const managerNames = new Map(accountManagers.map((manager) => [manager.id, manager.name]));
  const carrierNames = new Map(carriers.map((carrier) => [carrier.id, carrier.name]));
  const lineNames = new Map(linesOfBusiness.map((line) => [line.id, line.name]));

  const rows = groups.map((group) => {
    const groupIdentities = identities.filter((item) => item.groupId === group.id);
    const carrierIds = [...new Set([
      ...groupIdentities.map((item) => item.carrierId),
      ...commissionCarriers.filter((item) => item.groupId === group.id).map((item) => item.carrierId),
    ])];
    const lineIds = [...new Set([
      ...commissionLines.filter((item) => item.groupId === group.id).map((item) => item.lineOfBusinessId),
      ...allocations.filter((item) => item.groupId === group.id).map((item) => item.lineOfBusinessId),
    ])];
    const evidence = lineIds.map((lineOfBusinessId) => ({ groupId: group.id, lineOfBusinessId }));
    const compensation = groupCompensationLinesFor(group.id, linesOfBusiness, evidence, allocations, asOfMonth);
    const rollup = rollupGroupCompensationStatus(compensation);
    return {
      id: group.id,
      name: group.name,
      groupNumber: group.groupNumber,
      externalGroupNumbers: groupIdentities.map((item) => item.externalGroupNumber),
      primaryAgentId: group.primaryAgentId,
      primaryAgentName: group.primaryAgentId ? agentNames.get(group.primaryAgentId) ?? null : null,
      accountManagerId: group.accountManagerId,
      accountManagerName: group.accountManagerId ? managerNames.get(group.accountManagerId) ?? null : null,
      carrierIds,
      carrierNames: carrierIds.map((id) => carrierNames.get(id) ?? "Carrier"),
      lineOfBusinessIds: lineIds,
      lineOfBusinessNames: lineIds.map((id) => lineNames.get(id) ?? "Coverage"),
      compensationKind: rollup.kind,
      compensationLabel: rollup.label,
    } satisfies GroupDirectoryRow;
  });

  return {
    asOfMonth,
    rows,
    allocations,
    lookups: { agents, accountManagers, carriers, linesOfBusiness },
  };
}

export async function loadGroupWorkspace(db: AppDatabase | undefined, groupId: number) {
  const database = await resolveDb(db);
  const group = await getGroup(database, groupId);
  if (!group) throw new NotFoundError("Group not found.");
  const directory = await loadGroupDirectory(database);
  const teams = await listTeams(database);
  const allocations = directory.allocations;
  const commissions = await listGroupCommissions(database, groupId, GROUP_COMMISSION_LIMIT);
  const statementIds = [...new Set(commissions.flatMap((row) => row.importStatementId == null ? [] : [row.importStatementId]))];
  const statements = statementIds.length === 0
    ? []
    : await database.select({
      id: importStatements.id,
      displayName: importStatements.displayName,
    }).from(importStatements).where(inArray(importStatements.id, statementIds));
  const statementNames = new Map(statements.map((row) => [row.id, row.displayName]));
  const row = directory.rows.find((item) => item.id === groupId)!;
  const evidence = row.lineOfBusinessIds.map((lineOfBusinessId) => ({ groupId, lineOfBusinessId }));
  const compensationLines = groupCompensationLinesFor(
    groupId,
    directory.lookups.linesOfBusiness,
    evidence,
    allocations,
    directory.asOfMonth,
  );
  return {
    asOfMonth: directory.asOfMonth,
    group,
    directoryRow: row,
    identities: row.externalGroupNumbers,
    compensationLines,
    allocations: allocations.filter((item) => item.groupId === groupId),
    commissions: commissions.map((item) => ({
      ...item,
      statementName: item.importStatementId == null ? null : statementNames.get(item.importStatementId) ?? null,
    })) satisfies GroupCommissionRow[],
    lookups: {
      ...directory.lookups,
      teams,
    },
  };
}
