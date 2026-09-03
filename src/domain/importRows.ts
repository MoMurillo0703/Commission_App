import { resolveCompensationAgreement, type CompensationAgreementCandidate } from "./agreements";
import { mappingValue, type ColumnMapping } from "./columnMapping";
import { matchImportedGroup, type GroupCandidate } from "./groupMatch";
import { parseDollarsToCents, parsePercentToBps } from "./money";
import { matchNamedRecord, type NamedRecord } from "./nameMatch";
import type { PreviewSheet } from "./workbook";

export type ImportRowStatus = "ready" | "blocked" | "posted";

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
  lineOfBusinessId: number | null;
  lineOfBusinessLabel: string | null;
  agentId: number | null;
  agentLabel: string | null;
  premiumCents: number | null;
  grossCommissionCents: number | null;
  compensationBps: number | null;
  notes: string | null;
  exceptions: string[];
};

export type ImportReferenceData = {
  groups: GroupCandidate[];
  carriers: NamedRecord[];
  linesOfBusiness: NamedRecord[];
  agents: NamedRecord[];
  agreements?: CompensationAgreementCandidate[];
  statementCarrier?: NamedRecord | null;
};

export function resolveImportedCarrier(
  mapping: ColumnMapping,
  values: Record<string, string>,
  carriers: NamedRecord[],
  statementCarrier?: NamedRecord | null,
) {
  const source = mappingValue(values, mapping.carrier);
  if (source) return matchNamedRecord(carriers, source);
  if (statementCarrier) {
    return { status: "matched" as const, id: statementCarrier.id, name: statementCarrier.name, source: null };
  }
  return { status: "missing" as const, id: null, name: null, source: null };
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
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return value;
  const date = value.match(/^(0?[1-9]|1[0-2])[/-]\d{1,2}[/-](\d{4})$/);
  if (date) return `${date[2]}-${date[1].padStart(2, "0")}`;
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
      const key = sourceRowKey(sheet.name, row.rowNumber);
      const groupSourceName = mappingValue(row.values, mapping.groupName);
      const groupSourceNumber = mappingValue(row.values, mapping.groupNumber);
      const group = matchImportedGroup(references.groups, groupSourceName, groupSourceNumber);
      const mappedCarrier = mappingValue(row.values, mapping.carrier);
      const carrier = resolveImportedCarrier(mapping, row.values, references.carriers, references.statementCarrier);
      const line = matchNamedRecord(references.linesOfBusiness, mappingValue(row.values, mapping.lineOfBusiness));
      const matchedGroup = references.groups.find((candidate) => candidate.id === group.groupId);
      const agent = matchNamedRecord(references.agents, mappingValue(row.values, mapping.agent));
      const compensationText = mappingValue(row.values, mapping.compensationPercent);
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
        exceptions.push(`Unmatched group: ${group.sourceName || group.sourceNumber}. It will not be created automatically.`);
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

      let compensationBps: number | null = null;
      if (compensationText) {
        try {
          compensationBps = parsePercentToBps(compensationText);
        } catch {
          exceptions.push("Agent split % is not a valid percent.");
        }
      }

      const primaryAgent = matchedGroup?.primaryAgentId
        ? references.agents.find((candidate) => candidate.id === matchedGroup.primaryAgentId)
        : undefined;
      const resolvedAgentId = agent.id ?? (agent.status === "missing" ? primaryAgent?.id ?? null : null);
      const resolvedAgentLabel = agent.name ?? agent.source ?? primaryAgent?.name ?? null;
      if (
        compensationBps == null
        && resolvedAgentId != null
        && group.groupId != null
        && line.id != null
      ) {
        const agreement = resolveCompensationAgreement(references.agreements ?? [], {
          groupId: group.groupId,
          agentId: resolvedAgentId,
          lineOfBusinessId: line.id,
          paidMonth,
        });
        compensationBps = agreement?.compensationBps ?? 0;
      }
      if (agent.status === "missing" && !resolvedAgentId && compensationBps != null) {
        exceptions.push("Agent split % was provided without a matched agent.");
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
        lineOfBusinessId: line.id,
        lineOfBusinessLabel: line.name ?? line.source,
        agentId: resolvedAgentId,
        agentLabel: resolvedAgentLabel,
        premiumCents,
        grossCommissionCents,
        compensationBps: resolvedAgentId == null ? 0 : compensationBps,
        notes,
        exceptions: postedKeys.has(key) ? ["Already posted from this statement."] : exceptions,
      };
    }),
  );
}
