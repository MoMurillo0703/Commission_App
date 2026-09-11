import { eq } from "drizzle-orm";
import {
  buildCompensationDirectoryRows,
  emptyCompensationDirectoryFilters,
  filterCompensationDirectory,
  selectAllDirectoryKeys,
  type CompensationDirectoryFilters,
  type CompensationDirectorySourceRow,
} from "@/domain/compensationDirectory";
import { personKey, type PersonIdentity } from "@/domain/agencyOwner";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { carriers, commissionRecords } from "@/db/schema";
import { listAccountManagers } from "./accountManagers";
import { getAgencyOwnerForPaidMonth } from "./agencyOwner";
import { listAgents } from "./agents";
import { listAllocations, type AllocationView } from "./allocations";
import { listCarriers } from "./carriers";
import { listGroups } from "./groups";
import { listGroupLineEvidence } from "./groupLineEvidence";
import { listLinesOfBusiness } from "./linesOfBusiness";
import type { GroupLineEvidence } from "@/domain/activeGroupLines";
import type { AccountManager, Agent, Group, LineOfBusiness } from "@/db/schema";

export async function listPostedGroupLineCarriers(db?: AppDatabase) {
  const database = await resolveDb(db);
  return database
    .selectDistinct({
      groupId: commissionRecords.groupId,
      lineOfBusinessId: commissionRecords.lineOfBusinessId,
      carrierId: commissionRecords.carrierId,
      carrierName: carriers.name,
    })
    .from(commissionRecords)
    .innerJoin(carriers, eq(commissionRecords.carrierId, carriers.id));
}

export function compensationDirectorySources(input: {
  groups: Group[];
  allocations: AllocationView[];
  evidence: GroupLineEvidence[];
  agents: Agent[];
  accountManagers: AccountManager[];
  postedCarriers: Array<{ groupId: number; lineOfBusinessId: number; carrierId: number; carrierName: string }>;
}): CompensationDirectorySourceRow[] {
  const groupsById = new Map(input.groups.map((group) => [group.id, group]));
  const agentsById = new Map(input.agents.map((agent) => [agent.id, agent.name]));
  const managersById = new Map(input.accountManagers.map((manager) => [manager.id, manager.name]));
  const allocationsByPair = new Map<string, AllocationView[]>();
  for (const allocation of input.allocations) {
    const key = `${allocation.groupId}:${allocation.lineOfBusinessId}`;
    const current = allocationsByPair.get(key) ?? [];
    current.push(allocation);
    allocationsByPair.set(key, current);
  }
  const carriersByPair = new Map<string, Array<{ carrierId: number; carrierName: string }>>();
  for (const row of input.postedCarriers) {
    const key = `${row.groupId}:${row.lineOfBusinessId}`;
    const current = carriersByPair.get(key) ?? [];
    if (!current.some((item) => item.carrierId === row.carrierId)) current.push(row);
    carriersByPair.set(key, current);
  }
  const seen = new Set<string>();
  const sources: CompensationDirectorySourceRow[] = [];
  for (const pair of input.evidence) {
    const key = `${pair.groupId}:${pair.lineOfBusinessId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const group = groupsById.get(pair.groupId);
    if (!group) continue;
    const allocations = allocationsByPair.get(key) ?? [];
    const posted = carriersByPair.get(key) ?? [];
    sources.push({
      groupId: group.id,
      groupName: group.name,
      groupNumber: group.groupNumber,
      primaryAgentId: group.primaryAgentId,
      primaryAgentName: group.primaryAgentId != null ? agentsById.get(group.primaryAgentId) ?? null : null,
      accountManagerId: group.accountManagerId,
      accountManagerName: group.accountManagerId != null ? managersById.get(group.accountManagerId) ?? null : null,
      carrierIds: posted.map((row) => row.carrierId),
      carrierNames: posted.map((row) => row.carrierName),
      lineOfBusinessId: pair.lineOfBusinessId,
      lineOfBusinessName: allocations[0]?.lineOfBusinessName ?? "",
      allocations: allocations.map((row) => ({
        id: row.id,
        status: row.status,
        effectiveStart: row.effectiveStart,
        effectiveEnd: row.effectiveEnd,
        entries: row.entries,
      })),
    });
  }
  return sources;
}

export function projectCompensationDirectory(input: {
  groups: Group[];
  allocations: AllocationView[];
  evidence: GroupLineEvidence[];
  lines: LineOfBusiness[];
  agents: Agent[];
  accountManagers: AccountManager[];
  postedCarriers: Array<{ groupId: number; lineOfBusinessId: number; carrierId: number; carrierName: string }>;
  asOfMonth: string;
  owner: PersonIdentity | null;
}) {
  const names = new Map<string, string>();
  for (const agent of input.agents) names.set(`agent:${agent.id}`, agent.name);
  for (const manager of input.accountManagers) names.set(`account_manager:${manager.id}`, manager.name);
  const sources = compensationDirectorySources(input).map((source) => ({
    ...source,
    lineOfBusinessName: source.lineOfBusinessName
      || input.lines.find((line) => line.id === source.lineOfBusinessId)?.name
      || "Line of Coverage",
  }));
  return buildCompensationDirectoryRows({
    sources,
    lines: input.lines,
    asOfMonth: input.asOfMonth,
    owner: input.owner,
    personName: (kind, id) => names.get(`${kind}:${id}`) ?? "Person",
  });
}

export function parseCompensationDirectoryFilters(
  search: Record<string, string | string[] | undefined>,
  fallbackMonth: string,
): CompensationDirectoryFilters {
  const value = (key: string) => {
    const raw = search[key];
    return Array.isArray(raw) ? raw[0] : raw;
  };
  const number = (key: string) => {
    const parsed = Number(value(key) ?? "");
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  };
  const status = value("compensationStatus");
  return {
    query: value("query") ?? "",
    carrierId: number("carrierId"),
    lineOfBusinessId: number("lineOfBusinessId"),
    primaryAgentId: number("primaryAgentId"),
    accountManagerId: number("accountManagerId"),
    recipientKey: value("recipientKey") ?? null,
    teamId: number("teamId"),
    compensationStatus: status === "configured" || status === "default" || status === "review_required"
      ? status
      : "all",
    asOfMonth: value("asOfMonth") || fallbackMonth,
  };
}

export async function loadCompensationDirectory(
  db: AppDatabase | undefined,
  filters: CompensationDirectoryFilters,
) {
  const database = await resolveDb(db);
  const groups = await listGroups(database);
  const agents = await listAgents(database);
  const accountManagers = await listAccountManagers(database);
  const lines = await listLinesOfBusiness(database);
  const allocations = await listAllocations(database);
  const evidence = await listGroupLineEvidence(database);
  const postedCarriers = await listPostedGroupLineCarriers(database);
  const owner = await getAgencyOwnerForPaidMonth(database, filters.asOfMonth);
  const rows = filterCompensationDirectory(
    projectCompensationDirectory({
      groups,
      allocations,
      evidence,
      lines,
      agents,
      accountManagers,
      postedCarriers,
      asOfMonth: filters.asOfMonth,
      owner,
    }),
    filters,
    lines,
  );
  return {
    filters,
    owner,
    ownerKey: owner ? personKey(owner) : null,
    rows,
    keys: selectAllDirectoryKeys(rows),
    targets: rows.map((row) => ({
      key: row.key,
      groupId: row.groupId,
      lineOfBusinessId: row.lineOfBusinessId,
    })),
    total: rows.length,
    groupCount: new Set(rows.map((row) => row.groupId)).size,
  };
}

export async function loadCompensationDirectoryContext(db: AppDatabase | undefined, asOfMonth: string) {
  const database = await resolveDb(db);
  return {
    directory: await loadCompensationDirectory(database, emptyCompensationDirectoryFilters(asOfMonth)),
    carriers: await listCarriers(database),
  };
}
