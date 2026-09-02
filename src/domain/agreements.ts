import { paidMonthInRange } from "./dates";

export type AgreementStatus = "active" | "inactive";

export type CompensationAgreementCandidate = {
  id: number;
  groupId: number;
  agentId: number;
  lineOfBusinessId: number;
  compensationBps: number;
  effectiveStart: string;
  effectiveEnd: string | null;
  status: AgreementStatus;
};

export function resolveCompensationAgreement(
  agreements: CompensationAgreementCandidate[],
  query: {
    groupId: number;
    agentId: number;
    lineOfBusinessId: number;
    paidMonth: string;
  },
) {
  return agreements
    .filter((agreement) => (
      agreement.status === "active"
      && agreement.groupId === query.groupId
      && agreement.agentId === query.agentId
      && agreement.lineOfBusinessId === query.lineOfBusinessId
      && paidMonthInRange(query.paidMonth, agreement.effectiveStart, agreement.effectiveEnd)
    ))
    .sort((left, right) => right.effectiveStart.localeCompare(left.effectiveStart))[0] ?? null;
}
