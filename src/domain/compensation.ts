export function calculateAgentCompensationCents(grossCommissionCents: number, compensationBps: number) {
  if (!Number.isInteger(grossCommissionCents)) throw new Error("Gross commission must be integer cents.");
  if (!Number.isInteger(compensationBps) || compensationBps < 0 || compensationBps > 10000) {
    throw new Error("Compensation must be between 0 and 100 percent.");
  }
  return Math.round((grossCommissionCents * compensationBps) / 10000);
}

export function calculateAgencyNetCents(grossCommissionCents: number, agentCompensationCents: number) {
  if (!Number.isInteger(grossCommissionCents) || !Number.isInteger(agentCompensationCents)) {
    throw new Error("Amounts must be integer cents.");
  }
  return grossCommissionCents - agentCompensationCents;
}

export function settleCommission(grossCommissionCents: number, compensationBps: number) {
  const agentCompensationCents = calculateAgentCompensationCents(grossCommissionCents, compensationBps);
  return {
    compensationBps,
    agentCompensationCents,
    agencyNetCents: calculateAgencyNetCents(grossCommissionCents, agentCompensationCents),
  };
}
