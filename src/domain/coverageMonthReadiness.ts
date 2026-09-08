export type CoverageReceipt = {
  groupId: number;
  carrierId: number;
  lineOfBusinessId: number;
  paidMonth: string;
  coverageMonth: string | null;
  grossCommissionCents: number;
};

export function coverageReceiptsFor(
  rows: CoverageReceipt[],
  groupId: number,
  carrierId: number,
  lineOfBusinessId: number,
) {
  return rows
    .filter((row) => row.groupId === groupId && row.carrierId === carrierId && row.lineOfBusinessId === lineOfBusinessId)
    .map((row) => ({
      coverageMonth: row.coverageMonth,
      paidMonth: row.paidMonth,
      grossCommissionCents: row.grossCommissionCents,
    }));
}

export function missingCommissionDataReadiness(rows: CoverageReceipt[]) {
  const hasPaidMonth = rows.every((row) => /^\d{4}-(0[1-9]|1[0-2])$/.test(row.paidMonth));
  const missingCoverage = rows.filter((row) => row.coverageMonth == null || row.coverageMonth === "");
  return {
    canAnswerPaidMonthReceipt: hasPaidMonth,
    canAnswerCoverageMonthReceipt: missingCoverage.length === 0,
    missingCoverageMonthCount: missingCoverage.length,
    limitation: missingCoverage.length
      ? `${missingCoverage.length} commission${missingCoverage.length === 1 ? "" : "s"} lack a coverage/source month, so missing-commission analysis cannot yet prove every Group + Carrier + LOB coverage period.`
      : null,
  };
}
