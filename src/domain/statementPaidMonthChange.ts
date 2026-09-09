import { fingerprintBuffer } from "./fingerprint";
import { stableJson } from "./compensationCorrection";
import { payoutIdentityFingerprint } from "./payoutSnapshot";

export type PaidMonthInitiator = {
  id: string | null;
  email: string | null;
  name: string | null;
};

export type PaidMonthPayoutLike = {
  id?: number | null;
  recipientType: string;
  personKind?: string | null;
  personId?: number | null;
  personName?: string | null;
  teamId?: number | null;
  teamName?: string | null;
  parentPayoutId?: number | null;
  allocationId?: number | null;
  allocationBps: number;
  teamInternalBps?: number | null;
  compensationCents: number;
  createdAt?: string | null;
};

export type PaidMonthCommissionBind = {
  id: number;
  groupId: number;
  carrierId: number;
  lineOfBusinessId: number;
  grossCommissionCents: number;
  statementMonth: string;
  premiumMonth: string | null;
  sourceCoverageLabel: string | null;
  sourceGroupLabel: string | null;
  sourceLobLabel: string | null;
  sourcePeriodLabel: string | null;
  sourceReference: string | null;
  sourceRowKey: string | null;
  importStatementId: number | null;
  agentId: number | null;
  compensationBps: number | null;
  agentCompensationCents: number;
  agencyNetCents: number;
  corrected: boolean;
};

export type PaidMonthBoundPayout = PaidMonthPayoutLike & { commissionId: number };

export function paidMonthBoundState(input: {
  statementId: number;
  currentPaidMonth: string;
  newPaidMonth: string;
  commissions: PaidMonthCommissionBind[];
  payouts: PaidMonthBoundPayout[];
}) {
  return {
    statement: {
      statementId: input.statementId,
      currentPaidMonth: input.currentPaidMonth,
      newPaidMonth: input.newPaidMonth,
    },
    commissions: [...input.commissions].sort((left, right) => left.id - right.id),
    payouts: [...input.payouts].sort((left, right) => (
      left.commissionId - right.commissionId
      || (left.id ?? 0) - (right.id ?? 0)
    )),
  };
}

export function paidMonthPreviewToken(state: ReturnType<typeof paidMonthBoundState>) {
  return fingerprintBuffer(new TextEncoder().encode(stableJson(state)));
}

export function paidMonthRequestFingerprint(input: {
  statementId: number;
  previewToken: string;
  newPaidMonth: string;
  reason: string;
}) {
  return fingerprintBuffer(new TextEncoder().encode(stableJson({
    statementId: input.statementId,
    previewToken: input.previewToken,
    newPaidMonth: input.newPaidMonth,
    reason: input.reason.trim(),
  })));
}

export function statementPayoutFingerprint(
  commissions: Array<{ id: number; payouts: PaidMonthPayoutLike[] }>,
) {
  return fingerprintBuffer(new TextEncoder().encode(stableJson(
    [...commissions]
      .sort((left, right) => left.id - right.id)
      .map((row) => ({ id: row.id, payouts: payoutIdentityFingerprint(row.payouts) })),
  )));
}

export function stalePaidMonthPreviewMessage() {
  return "The paid-month preview no longer matches the current statement. Preview again.";
}

export function paidMonthAuditClassification(input: { payoutCount: number }) {
  return {
    financialSnapshotsPreserved: true,
    compensationRecalculation: "none",
    payoutCount: input.payoutCount,
    payoutCorrectionRequired: false,
    payoutCorrectionPerformed: false,
  };
}

export function invariantStateAfterPaidMonthMove(state: ReturnType<typeof paidMonthBoundState>) {
  return stableJson({
    commissions: state.commissions.map((row) => ({
      id: row.id,
      groupId: row.groupId,
      carrierId: row.carrierId,
      lineOfBusinessId: row.lineOfBusinessId,
      grossCommissionCents: row.grossCommissionCents,
      premiumMonth: row.premiumMonth,
      sourceCoverageLabel: row.sourceCoverageLabel,
      sourceGroupLabel: row.sourceGroupLabel,
      sourceLobLabel: row.sourceLobLabel,
      sourcePeriodLabel: row.sourcePeriodLabel,
      sourceReference: row.sourceReference,
      sourceRowKey: row.sourceRowKey,
      importStatementId: row.importStatementId,
      agentId: row.agentId,
      compensationBps: row.compensationBps,
      agentCompensationCents: row.agentCompensationCents,
      agencyNetCents: row.agencyNetCents,
      corrected: row.corrected,
    })),
    payouts: state.payouts,
  });
}
