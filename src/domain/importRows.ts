import { resolveCompensationAgreement, type CompensationAgreementCandidate } from "./agreements";
import {
  implicitAgencyAllocation,
  previewCompensationBps,
  resolveCompensationAllocation,
  settleAllocation,
  type AllocationCandidate,
  type TeamShare,
} from "./allocations";
import { mappingValue, type ColumnMapping } from "./columnMapping";
import { calculateAgentCompensationCents } from "./compensation";
import { applyGroupResolutions, matchImportedGroup, type GroupCandidate, type GroupImportResolution } from "./groupMatch";
import { parseFlexibleMonth } from "./dates";
import { parseDollarsToCents } from "./money";
import { applyCarrierCoverageAlias, type CarrierCoverageAlias } from "./carrierCoverage";
import { resolveNamedImport, type NamedImportResolution } from "./namedImport";
import { matchNamedRecord, type NamedRecord } from "./nameMatch";
import type { PreviewSheet } from "./workbook";

export type ImportRowStatus = "ready" | "blocked" | "posted";
export type CarrierSourceKind = "statement" | "column";

export type ValidatedImportRow = {
  sourceRowKey: string;
  sheetName: string;
  rowNumber: number;
  status: ImportRowStatus;
  paidMonth: string;
  premiumMonth: string | null;
  groupId: number | null;
  groupLabel: string | null;
  carrierId: number | null;
  carrierLabel: string | null;
  carrierSource: CarrierSourceKind | null;
  lineOfBusinessId: number | null;
  lineOfBusinessLabel: string | null;
  agentId: number | null;
  agentLabel: string | null;
  premiumCents: number | null;
  grossCommissionCents: number | null;
  compensationBps: number | null;
  compensationDistributedCents: number | null;
  agencyNetCents: number | null;
  notes: string | null;
  importedGroupName: string | null;
  importedGroupNumber: string | null;
  importedLineName: string | null;
  importedAgentName: string | null;
  exceptions: string[];
};

export type ImportReferenceData = {
  groups: GroupCandidate[];
  carriers: NamedRecord[];
  linesOfBusiness: NamedRecord[];
  agents: NamedRecord[];
  agreements?: CompensationAgreementCandidate[];
  allocations?: AllocationCandidate[];
  teams?: Map<number, TeamShare>;
  personNames?: Record<string, string>;
  statementCarrier?: NamedRecord | null;
  groupResolutions?: GroupImportResolution[];
  lineResolutions?: NamedImportResolution[];
  agentResolutions?: NamedImportResolution[];
  carrierCoverageAliases?: CarrierCoverageAlias[];
};

export function resolveImportedCarrier(
  mapping: ColumnMapping,
  values: Record<string, string>,
  carriers: NamedRecord[],
  statementCarrier?: NamedRecord | null,
) {
  const source = mappingValue(values, mapping.carrier);
  if (source) return { ...matchNamedRecord(carriers, source), sourceKind: "column" as const };
  if (statementCarrier) {
    return {
      status: "matched" as const,
      id: statementCarrier.id,
      name: statementCarrier.name,
      source: null,
      sourceKind: "statement" as const,
    };
  }
  return { status: "missing" as const, id: null, name: null, source: null, sourceKind: null };
}

export function sourceRowKey(sheetName: string, rowNumber: number) {
  return `${sheetName}:${rowNumber}`;
}

function parseOptionalMoney(value: string | null, label: string, exceptions: string[]) {
  if (!value) return null;
  try {
    return parseDollarsToCents(value);
  } catch {
    exceptions.push(`${label} is not a valid dollar amount.`);
    return null;
  }
}

function normalizeImportedMonth(value: string | null, exceptions: string[]) {
  if (!value) return null;
  const parsed = parseFlexibleMonth(value);
  if (parsed) return parsed;
  exceptions.push("Premium / coverage month is not a valid month or date.");
  return null;
}

export function validateMappedRows(
  sheets: PreviewSheet[],
  mapping: ColumnMapping,
  paidMonth: string,
  references: ImportReferenceData,
  postedKeys: Set<string> = new Set(),
): ValidatedImportRow[] {
  return sheets.flatMap((sheet) =>
    sheet.rows.map((row) => {
      const exceptions: string[] = [];
      const key = row.sourceIdentity ?? sourceRowKey(sheet.name, row.rowNumber);
      const groupSourceName = mappingValue(row.values, mapping.groupName);
      const groupSourceNumber = mappingValue(row.values, mapping.groupNumber);
      const group = applyGroupResolutions(
        matchImportedGroup(references.groups, groupSourceName, groupSourceNumber),
        references.groupResolutions,
        references.groups,
      );
      const mappedCarrier = mappingValue(row.values, mapping.carrier);
      const carrier = resolveImportedCarrier(mapping, row.values, references.carriers, references.statementCarrier);
      const importedLineName = mappingValue(row.values, mapping.lineOfBusiness);
      const importedAgentName = mappingValue(row.values, mapping.agent);
      const line = applyCarrierCoverageAlias(
        resolveNamedImport(references.linesOfBusiness, importedLineName, references.lineResolutions),
        references.carrierCoverageAliases,
        carrier.id,
        importedLineName,
        references.linesOfBusiness,
      );
      const matchedGroup = references.groups.find((candidate) => candidate.id === group.groupId);
      const agent = resolveNamedImport(references.agents, importedAgentName, references.agentResolutions);
      const grossText = mappingValue(row.values, mapping.grossCommission);
      const premiumMonth = normalizeImportedMonth(mappingValue(row.values, mapping.premiumMonth) ?? row.premiumMonth, exceptions);
      const notes = mappingValue(row.values, mapping.notes);

      if (!mapping.groupName && !mapping.groupNumber) exceptions.push("Map a group name or group number column.");
      if (!mappedCarrier && !references.statementCarrier && !mapping.carrier) {
        exceptions.push("Map a carrier column.");
      }
      if (!mapping.lineOfBusiness) exceptions.push("Map a line of business column.");
      if (!mapping.grossCommission) exceptions.push("Map a gross commission column.");

      if (group.status === "missing") exceptions.push("Group is missing.");
      if (group.status === "new_group") {
        exceptions.push(`Unmatched group: ${group.sourceName || group.sourceNumber}. Confirm it as a new group or match an existing group.`);
      }
      if (group.status === "ambiguous") {
        exceptions.push(`Ambiguous group: ${group.sourceName || group.sourceNumber}. Confirm it as a new group or match an existing group.`);
      }
      if (carrier.status === "missing") exceptions.push("Carrier is missing.");
      if (carrier.status === "unmatched") exceptions.push(`Unmatched carrier: ${carrier.source}.`);
      if (carrier.status === "ambiguous") exceptions.push(`Carrier name matches more than one record: ${carrier.source}.`);
      if (line.status === "missing") exceptions.push("Line of business is missing.");
      if (line.status === "unmatched") exceptions.push(`Unmatched line of business: ${line.source}.`);
      if (line.status === "ambiguous") exceptions.push(`Line of business matches more than one record: ${line.source}.`);
      if (agent.status === "unmatched") exceptions.push(`Unmatched agent: ${agent.source}.`);
      if (agent.status === "ambiguous") exceptions.push(`Agent name matches more than one record: ${agent.source}.`);

      const premiumCents = parseOptionalMoney(mappingValue(row.values, mapping.premium), "Premium", exceptions);
      let grossCommissionCents: number | null = null;
      if (grossText) {
        try {
          grossCommissionCents = parseDollarsToCents(grossText);
        } catch {
          exceptions.push("Gross commission is not a valid dollar amount.");
        }
      } else if (mapping.grossCommission) {
        exceptions.push("Gross commission is missing.");
      }

      const primaryAgent = matchedGroup?.primaryAgentId
        ? references.agents.find((candidate) => candidate.id === matchedGroup.primaryAgentId)
        : undefined;
      const resolvedAgentId = agent.id ?? (agent.status === "missing" ? primaryAgent?.id ?? null : null);
      const resolvedAgentLabel = agent.name ?? agent.source ?? primaryAgent?.name ?? null;
      let compensationBps = 0;
      let compensationDistributedCents: number | null = null;
      let agencyNetCents: number | null = null;
      if (group.groupId != null && line.id != null && grossCommissionCents != null) {
        const names = {
          agencyName: "Murillo Insurance",
          personName: (kind: "agent" | "account_manager", id: number) => (
            references.personNames?.[`${kind}:${id}`] ?? (kind === "agent" ? "Person" : "Person")
          ),
        };
        const allocation = resolveCompensationAllocation(references.allocations ?? [], {
          groupId: group.groupId,
          lineOfBusinessId: line.id,
          paidMonth,
        });
        try {
          let settled;
          let legacyCompensationBps: number | null = null;
          if (allocation) {
            settled = settleAllocation(grossCommissionCents, allocation.entries, references.teams ?? new Map(), names);
          } else if (resolvedAgentId != null) {
            const legacy = resolveCompensationAgreement(references.agreements ?? [], {
              groupId: group.groupId,
              agentId: resolvedAgentId,
              lineOfBusinessId: line.id,
              paidMonth,
            });
            settled = legacy
              ? {
                allocatedBps: legacy.compensationBps,
                remainingBps: 10000 - legacy.compensationBps,
                complete: legacy.compensationBps === 10000,
                compensationDistributedCents: calculateAgentCompensationCents(grossCommissionCents, legacy.compensationBps),
                agencyNetCents: grossCommissionCents - calculateAgentCompensationCents(grossCommissionCents, legacy.compensationBps),
                payouts: [],
              }
              : implicitAgencyAllocation(grossCommissionCents, "Murillo Insurance");
            legacyCompensationBps = legacy?.compensationBps ?? null;
          } else {
            settled = implicitAgencyAllocation(grossCommissionCents, "Murillo Insurance");
          }
          if (settled) {
            compensationBps = legacyCompensationBps ?? previewCompensationBps(settled, resolvedAgentId);
            compensationDistributedCents = settled.compensationDistributedCents;
            agencyNetCents = settled.agencyNetCents;
          }
        } catch (error) {
          compensationBps = 0;
          exceptions.push(error instanceof Error ? error.message : "Compensation allocation requires review.");
        }
      }

      const ready = exceptions.length === 0 && group.groupId != null && carrier.id != null && line.id != null && grossCommissionCents != null;
      const status: ImportRowStatus = postedKeys.has(key) ? "posted" : ready ? "ready" : "blocked";

      return {
        sourceRowKey: key,
        sheetName: sheet.name,
        rowNumber: row.rowNumber,
        status,
        paidMonth,
        premiumMonth,
        groupId: group.groupId,
        groupLabel: group.groupName ?? group.sourceName ?? group.sourceNumber,
        carrierId: carrier.id,
        carrierLabel: carrier.name ?? carrier.source,
        carrierSource: carrier.sourceKind,
        lineOfBusinessId: line.id,
        lineOfBusinessLabel: line.name ?? line.source,
        agentId: resolvedAgentId,
        agentLabel: resolvedAgentLabel,
        premiumCents,
        grossCommissionCents,
        compensationBps,
        compensationDistributedCents,
        agencyNetCents,
        notes,
        importedGroupName: group.sourceName,
        importedGroupNumber: group.sourceNumber,
        importedLineName,
        importedAgentName,
        exceptions: postedKeys.has(key) ? ["Already posted from this statement."] : exceptions,
      };
    }),
  );
}
