"use client";

import { FormEvent, useMemo, useState } from "react";
import type { TeamView } from "@/data/teams";
import type { AccountManager, Agent, Carrier, Group, LineOfBusiness } from "@/db/schema";
import { formatCents } from "@/domain/money";
import { formatStatementMonth } from "@/domain/dates";
import type { AgencyReportRow, IndividualReportRow, ReportKind, TeamReportRow } from "@/domain/reports";
import {
  SHARE_PERCENT_UNAVAILABLE,
  groupIndividualReportRows,
  formatCoverageOrSourcePeriod,
  individualTransactionCells,
  informalRecipientName,
  topClientRowKey,
} from "@/domain/reportPresentation";
import {
  individualReportNeedsRecipientAndMonth,
  individualReportPrompt,
  renderedReportKind,
} from "@/domain/reportWorkspace";

type ReportResponse = {
  filters: { kind: ReportKind };
  names: Record<string, string | null | undefined>;
  rows: AgencyReportRow[] | IndividualReportRow[] | TeamReportRow[];
  totals: Record<string, number>;
  document?: {
    title: string;
    heading?: string;
    subheading?: string;
    period: string;
    totals: Array<{ label: string; value: string }>;
    footerTotals?: Array<{ label: string; value: string }>;
    filtersUsed?: string[];
    generatedAt?: string;
    notes?: string[];
  };
  executive?: {
    carrierBreakdown: { rows: Array<{ id: number; name: string; cents: number; percent: string }>; totalCents: number; totalPercent?: string };
    topClients: { rows: Array<{ id: number; name: string; cents: number; percent: string }>; combinedCents: number; combinedPercent: string };
  };
  emptyMessage?: string | null;
  availability?: { postedCommissionCount: number; availablePaidMonths: string[] };
  payable?: {
    payableReady: boolean;
    message: string | null;
    reviewHref?: string | null;
    unallocated?: Array<{ commissionId: number; groupName: string; lineOfBusinessName: string }>;
  };
};

export function ReportsWorkspace({
  groups,
  carriers,
  linesOfBusiness,
  agents,
  accountManagers,
  teams,
  initialReport = null,
  initialFilters = null,
}: {
  groups: Group[];
  carriers: Carrier[];
  linesOfBusiness: LineOfBusiness[];
  agents: Agent[];
  accountManagers: AccountManager[];
  teams: TeamView[];
  initialReport?: ReportResponse | null;
  initialFilters?: {
    kind?: ReportKind;
    personKey?: string;
    paidMonth?: string;
    groupId?: string;
  } | null;
}) {
  const [kind, setKind] = useState<ReportKind>(initialFilters?.kind ?? "individual");
  const [paidMonth, setPaidMonth] = useState(initialFilters?.paidMonth ?? "");
  const [startMonth, setStartMonth] = useState("");
  const [endMonth, setEndMonth] = useState("");
  const [ytd, setYtd] = useState(false);
  const [groupId, setGroupId] = useState(initialFilters?.groupId ?? "");
  const [carrierId, setCarrierId] = useState("");
  const [lineOfBusinessId, setLineOfBusinessId] = useState("");
  const [personKey, setPersonKey] = useState(initialFilters?.personKey ?? "");
  const [teamId, setTeamId] = useState("");
  const [accountManagerId, setAccountManagerId] = useState("");
  const [primaryAgentId, setPrimaryAgentId] = useState("");
  const [report, setReport] = useState<ReportResponse | null>(initialReport);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const people = useMemo(() => [
    { key: "agency_owner", label: "Mo / Agency · combined business view" },
    ...agents.map((agent) => ({ key: `agent:${agent.id}`, label: `${agent.name} · Agent` })),
    ...accountManagers.map((manager) => ({ key: `account_manager:${manager.id}`, label: `${manager.name} · Account manager` })),
  ], [accountManagers, agents]);

  function queryString(format?: string) {
    const params = new URLSearchParams({ kind });
    if (paidMonth) params.set("paidMonth", paidMonth);
    if (startMonth) params.set("startMonth", startMonth);
    if (endMonth) params.set("endMonth", endMonth);
    if (ytd) params.set("ytd", "1");
    if (groupId) params.set("groupId", groupId);
    if (carrierId) params.set("carrierId", carrierId);
    if (lineOfBusinessId) params.set("lineOfBusinessId", lineOfBusinessId);
    if (personKey === "agency_owner") {
      params.set("personKind", "agency_owner");
    } else if (personKey) {
      const [personKind, personId] = personKey.split(":");
      params.set("personKind", personKind);
      params.set("personId", personId);
    }
    if (teamId) params.set("teamId", teamId);
    if (accountManagerId) params.set("accountManagerId", accountManagerId);
    if (primaryAgentId) params.set("primaryAgentId", primaryAgentId);
    if (format) params.set("format", format);
    return params.toString();
  }

  async function run(event?: FormEvent) {
    event?.preventDefault();
    if (individualReportNeedsRecipientAndMonth(kind) && (!personKey || !paidMonth)) {
      setError("Choose a recipient and a paid month to generate an Individual Commission Report.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/reports?${queryString()}`);
      const body = await response.json();
      if (!response.ok) {
        setError(body.message ?? "Unable to build report.");
        return;
      }
      setReport(body);
    } catch {
      setError("Unable to build report.");
    } finally {
      setBusy(false);
    }
  }

  const displayedKind = renderedReportKind(report);

  return (
    <>
      <section className="panel">
        <form className="form-grid form-grid-wide" onSubmit={(event) => void run(event)}>
          <label>
            Report
            <select value={kind} onChange={(event) => setKind(event.target.value as ReportKind)}>
              <option value="individual">Individual Commission Report</option>
              <option value="recipient">Recipient commission statement</option>
              <option value="agency">Agency commission</option>
              <option value="team">Team compensation</option>
            </select>
          </label>
          <label>
            Paid month
            <input type="month" value={paidMonth} onChange={(event) => { setPaidMonth(event.target.value); setYtd(false); }} />
          </label>
          <label>
            From
            <input type="month" value={startMonth} onChange={(event) => { setStartMonth(event.target.value); setPaidMonth(""); setYtd(false); }} />
          </label>
          <label>
            Through
            <input type="month" value={endMonth} onChange={(event) => { setEndMonth(event.target.value); setPaidMonth(""); setYtd(false); }} />
          </label>
          <label className="role-toggles">
            <input type="checkbox" checked={ytd} onChange={(event) => { setYtd(event.target.checked); if (event.target.checked) setPaidMonth(""); }} />
            Year to date
          </label>
          <label>
            Group
            <select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
              <option value="">All groups</option>
              {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </label>
          <label>
            Carrier
            <select value={carrierId} onChange={(event) => setCarrierId(event.target.value)}>
              <option value="">All carriers</option>
              {carriers.map((carrier) => <option key={carrier.id} value={carrier.id}>{carrier.name}</option>)}
            </select>
          </label>
          <label>
            Line of business
            <select value={lineOfBusinessId} onChange={(event) => setLineOfBusinessId(event.target.value)}>
              <option value="">All lines</option>
              {linesOfBusiness.map((line) => <option key={line.id} value={line.id}>{line.name}</option>)}
            </select>
          </label>
          <label>
            Recipient
            <select value={personKey} onChange={(event) => setPersonKey(event.target.value)}>
              <option value="">All people</option>
              {people.map((person) => <option key={person.key} value={person.key}>{person.label}</option>)}
            </select>
          </label>
          <label>
            Team
            <select value={teamId} onChange={(event) => setTeamId(event.target.value)}>
              <option value="">All teams</option>
              {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
          <label>
            Account manager
            <select value={accountManagerId} onChange={(event) => setAccountManagerId(event.target.value)}>
              <option value="">All</option>
              {accountManagers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}
            </select>
          </label>
          <label>
            Primary agent
            <select value={primaryAgentId} onChange={(event) => setPrimaryAgentId(event.target.value)}>
              <option value="">All</option>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
          </label>
          {error && <p className="form-error">{error}</p>}
          {!report && !error && individualReportNeedsRecipientAndMonth(kind) && (
            <p className="muted-note full">{individualReportPrompt()}</p>
          )}
          <div className="form-actions full">
            <button disabled={busy}>{busy ? "Building…" : "Run report"}</button>
            {report && (
              <>
                <a className="secondary" href={`/api/reports?${queryString("csv")}`}>CSV</a>
                <a className="secondary" href={`/api/reports?${queryString("xlsx")}`}>XLSX</a>
                <a className="secondary" href={`/api/reports?${queryString("pdf")}`}>Download PDF</a>
                <a className="secondary" href={`/api/reports?${queryString("print")}`} target="_blank" rel="noreferrer">Print</a>
              </>
            )}
          </div>
        </form>
      </section>

      {report && (
        <section className="panel recent report-doc">
          <div className="report-letterhead">
            <p className="eyebrow">Murillo Insurance</p>
            <h2>{report.document?.heading ?? report.document?.title ?? "Report"}</h2>
            <p className="report-period">{report.document?.subheading ?? report.document?.period}</p>
            {report.document?.generatedAt && (
              <p className="report-generated">Generated {new Date(report.document.generatedAt).toLocaleString("en-US")}</p>
            )}
            {report.document?.filtersUsed && (
              <p className="report-filters">{report.document.filtersUsed.join(" · ")}</p>
            )}
            {report.document?.notes?.map((note) => (
              <p key={note} className="report-filters">{note}</p>
            ))}
            {report.payable?.message && (
              <div className="form-error">
                <p>{report.payable.message}</p>
                {report.payable.reviewHref && (
                  <p className="form-actions" style={{ marginTop: 10 }}>
                    <a className="secondary" href={report.payable.reviewHref}>Review Compensation</a>
                  </p>
                )}
              </div>
            )}
            {(displayedKind === "recipient" || displayedKind === "individual") && report.payable?.payableReady && !report.emptyMessage && (
              <p className="form-success">Payable from posted commissions. This is not a payment record.</p>
            )}
          </div>
          <div className="stats report-summary">
            {!report.emptyMessage && (report.document?.totals ?? []).map((total) => (
              <article key={total.label} className="card">
                <p>{total.label}</p>
                <strong>{total.value}</strong>
              </article>
            ))}
          </div>
          {report.emptyMessage && <p className="empty">{report.emptyMessage}</p>}
          {!report.emptyMessage && displayedKind === "agency" && (
            <AgencyReportView rows={report.rows as AgencyReportRow[]} executive={report.executive} />
          )}
          {!report.emptyMessage && (displayedKind === "individual" || displayedKind === "recipient") && (
            <IndividualStatement
              rows={report.rows as IndividualReportRow[]}
              recipientName={report.names.personName ?? (report.rows as IndividualReportRow[])[0]?.recipientName ?? "Recipient"}
              footerTotals={report.document?.footerTotals}
            />
          )}
          {!report.emptyMessage && displayedKind === "team" && <TeamTable rows={report.rows as TeamReportRow[]} />}
        </section>
      )}
    </>
  );
}

function moneyCell(cents: number | null) {
  if (cents == null) return <td className="num">—</td>;
  return <td className={`num${cents < 0 ? " neg" : ""}`}>{formatCents(cents)}</td>;
}

function AgencyReportView({
  rows,
  executive,
}: {
  rows: AgencyReportRow[];
  executive?: {
    carrierBreakdown: { rows: Array<{ id: number; name: string; cents: number; percent: string }>; totalCents: number; totalPercent?: string };
    topClients: { rows: Array<{ id: number; name: string; cents: number; percent: string }>; combinedCents: number; combinedPercent: string };
  };
}) {
  if (rows.length === 0) return <p className="empty">No posted commissions match the current filters.</p>;
  return (
    <>
      {executive && (
        <div className="report-executive">
          <section className="report-block">
            <h3>Carrier Breakdown</h3>
            <table className="report-table report-table-compact">
              <thead>
                <tr>
                  <th>Carrier</th>
                  <th className="num">Commission</th>
                  <th className="num">% of Month</th>
                </tr>
              </thead>
              <tbody>
                {executive.carrierBreakdown.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    {moneyCell(row.cents)}
                    <td className="num">{row.percent}</td>
                  </tr>
                ))}
                <tr className="report-total-row">
                  <td>TOTAL</td>
                  {moneyCell(executive.carrierBreakdown.totalCents)}
                  <td className="num">{executive.carrierBreakdown.totalPercent ?? SHARE_PERCENT_UNAVAILABLE}</td>
                </tr>
              </tbody>
            </table>
          </section>
          <section className="report-block">
            <h3>Top 5 Clients This Month</h3>
            <table className="report-table report-table-compact">
              <thead>
                <tr>
                  <th>Client</th>
                  <th className="num">Commission</th>
                  <th className="num">% of Month</th>
                </tr>
              </thead>
              <tbody>
                {executive.topClients.rows.map((row) => (
                  <tr key={topClientRowKey(row.id)} data-group-id={row.id}>
                    <td>{row.name}</td>
                    {moneyCell(row.cents)}
                    <td className="num">{row.percent}</td>
                  </tr>
                ))}
                <tr className="report-total-row">
                  <td>TOP 5 TOTAL</td>
                  {moneyCell(executive.topClients.combinedCents)}
                  <td className="num">{executive.topClients.combinedPercent}</td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>
      )}
      <table className="report-table">
        <thead>
            <tr>
              <th>Paid Month</th>
              <th>Coverage Month / Source Period</th>
              <th>Group</th>
              <th>Carrier</th>
              <th>LOB</th>
              <th className="num">Premium</th>
              <th className="num">Gross Commission</th>
              <th className="num">Compensation Distributed</th>
              <th className="num">Agency Net</th>
            </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.groupId}-${row.carrierId}-${row.lineOfBusinessId}-${row.paidMonth}-${index}`}>
              <td>{formatStatementMonth(row.paidMonth)}</td>
              <td>{formatCoverageOrSourcePeriod(row)}</td>
              <td>{row.groupName}</td>
              <td>{row.carrierName}</td>
              <td>{row.lineOfBusinessName}</td>
              {moneyCell(row.premiumCents)}
              {moneyCell(row.grossCommissionCents)}
              {moneyCell(row.compensationDistributedCents)}
              {moneyCell(row.agencyNetCents)}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function IndividualStatement({
  rows,
  recipientName,
  footerTotals,
}: {
  rows: IndividualReportRow[];
  recipientName: string;
  footerTotals?: Array<{ label: string; value: string }>;
}) {
  if (rows.length === 0 && (!footerTotals || footerTotals.length === 0)) {
    return <p className="empty">No current calculated earnings match this recipient and paid month.</p>;
  }
  if (rows.length === 0) {
    return (
      <section className="report-grand-total">
        <h3>Grand Total</h3>
        <div className="stats report-summary">
          {footerTotals!.map((total) => (
            <article key={total.label} className="card">
              <p>{total.label}</p>
              <strong className={total.value.startsWith("-") ? "neg" : undefined}>{total.value}</strong>
            </article>
          ))}
        </div>
      </section>
    );
  }
  const informal = informalRecipientName(recipientName);
  const groups = groupIndividualReportRows(rows);
  const reviewRows = rows.filter((row) => row.reviewRequired);
  return (
    <>
      {reviewRows.length > 0 && (
        <p className="form-error">REVIEW REQUIRED — {reviewRows.length} commission{reviewRows.length === 1 ? "" : "s"} need a valid allocation or Team membership before earnings can be calculated.</p>
      )}
      {groups.map((group) => {
        const shareHeader = `${informal}'s %`;
        const recipientHeader = `${informal}'s Comm`;
        return (
          <section key={group.groupId} className="report-block">
            <h3>{group.groupName}</h3>
            {group.subtitle && <p className="report-group-sub">{group.subtitle}</p>}
            <table className="report-table report-table-compact">
              <thead>
                <tr>
                  <th>Carrier</th>
                  <th>LOB</th>
                  <th>Coverage Month / Source Period</th>
                  <th className="num">Agency Comm</th>
                  <th className="num">{shareHeader}</th>
                  <th className="num">{recipientHeader}</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row, index) => {
                  const cells = individualTransactionCells(row, informal);
                  return (
                    <tr key={row.payoutId ?? `${row.commissionId}-${row.recipientMethod}-${index}`}>
                      <td>{cells.carrier}</td>
                      <td>{cells.lob}</td>
                      <td>{cells.coverageMonth}</td>
                      {moneyCell(row.grossCommissionCents)}
                      <td className="num">{cells.share}</td>
                      {row.reviewRequired ? <td>REVIEW REQUIRED</td> : moneyCell(row.compensationCents)}
                    </tr>
                  );
                })}
                <tr className="report-total-row">
                  <td colSpan={3}>GROUP TOTAL</td>
                  {moneyCell(group.agencyCommissionCents)}
                  <td />
                  {moneyCell(group.recipientCompensationCents)}
                </tr>
              </tbody>
            </table>
          </section>
        );
      })}
      {footerTotals && footerTotals.length > 0 && (
        <section className="report-grand-total">
          <h3>Grand Total</h3>
          <div className="stats report-summary">
            {footerTotals.map((total) => (
              <article key={total.label} className="card">
                <p>{total.label}</p>
                <strong className={total.value.startsWith("-") ? "neg" : undefined}>{total.value}</strong>
              </article>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function TeamTable({ rows }: { rows: TeamReportRow[] }) {
  if (rows.length === 0) return <p className="empty">No posted commissions match the current filters.</p>;
  return (
    <table className="report-table">
      <thead>
        <tr>
          <th>Paid Month</th>
          <th>Team</th>
          <th>Group</th>
          <th>LOB</th>
          <th>Gross</th>
          <th>Team %</th>
          <th>Team Compensation</th>
          <th>Member</th>
          <th>Member Compensation</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.teamId}-${row.groupId}-${row.memberName}-${index}`}>
            <td>{formatStatementMonth(row.paidMonth)}</td>
            <td>{row.teamName}</td>
            <td>{row.groupName}</td>
            <td>{row.lineOfBusinessName}</td>
            {moneyCell(row.grossCommissionCents)}
            <td className="num">{`${(row.teamAllocationBps / 100).toFixed(row.teamAllocationBps % 100 === 0 ? 0 : 2)}%`}</td>
            {moneyCell(row.teamCompensationCents)}
            <td>{row.memberName}</td>
            {moneyCell(row.memberCompensationCents)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
