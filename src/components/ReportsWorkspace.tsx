"use client";

import { FormEvent, useMemo, useState } from "react";
import type { TeamView } from "@/data/teams";
import type { AccountManager, Agent, Carrier, Group, LineOfBusiness } from "@/db/schema";
import { formatCents } from "@/domain/money";
import { formatStatementMonth } from "@/domain/dates";
import type { AgencyReportRow, IndividualReportRow, ReportKind, TeamReportRow } from "@/domain/reports";

type ReportResponse = {
  filters: { kind: ReportKind };
  names: Record<string, string | null | undefined>;
  rows: AgencyReportRow[] | IndividualReportRow[] | TeamReportRow[];
  totals: Record<string, number>;
  document?: { title: string; period: string; totals: Array<{ label: string; value: string }> };
};

export function ReportsWorkspace({
  groups,
  carriers,
  linesOfBusiness,
  agents,
  accountManagers,
  teams,
}: {
  groups: Group[];
  carriers: Carrier[];
  linesOfBusiness: LineOfBusiness[];
  agents: Agent[];
  accountManagers: AccountManager[];
  teams: TeamView[];
}) {
  const [kind, setKind] = useState<ReportKind>("agency");
  const [paidMonth, setPaidMonth] = useState("");
  const [startMonth, setStartMonth] = useState("");
  const [endMonth, setEndMonth] = useState("");
  const [ytd, setYtd] = useState(false);
  const [groupId, setGroupId] = useState("");
  const [carrierId, setCarrierId] = useState("");
  const [lineOfBusinessId, setLineOfBusinessId] = useState("");
  const [personKey, setPersonKey] = useState("");
  const [teamId, setTeamId] = useState("");
  const [accountManagerId, setAccountManagerId] = useState("");
  const [primaryAgentId, setPrimaryAgentId] = useState("");
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const people = useMemo(() => [
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
    if (personKey) {
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
    setBusy(true);
    setError("");
    const response = await fetch(`/api/reports?${queryString()}`);
    const body = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(body.message ?? "Unable to build report.");
      return;
    }
    setReport(body);
  }

  return (
    <>
      <section className="panel">
        <form className="form-grid form-grid-wide" onSubmit={(event) => void run(event)}>
          <label>
            Report
            <select value={kind} onChange={(event) => setKind(event.target.value as ReportKind)}>
              <option value="agency">Agency commission</option>
              <option value="individual">Individual compensation</option>
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
          <div className="form-actions full">
            <button disabled={busy}>{busy ? "Building…" : "Run report"}</button>
            {report && (
              <>
                <a className="secondary" href={`/api/reports?${queryString("csv")}`}>CSV</a>
                <a className="secondary" href={`/api/reports?${queryString("xlsx")}`}>XLSX</a>
                <a className="secondary" href={`/api/reports?${queryString("print")}`} target="_blank" rel="noreferrer">Print / PDF</a>
              </>
            )}
          </div>
        </form>
      </section>

      {report && (
        <section className="panel recent">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Murillo Insurance</p>
              <h2>{report.document?.title ?? "Report"}</h2>
              <p>{report.document?.period}</p>
            </div>
          </div>
          <div className="stats">
            {(report.document?.totals ?? []).map((total) => (
              <article key={total.label} className="card">
                <p>{total.label}</p>
                <strong>{total.value}</strong>
              </article>
            ))}
          </div>
          {kind === "agency" && <AgencyTable rows={report.rows as AgencyReportRow[]} />}
          {kind === "individual" && <IndividualTable rows={report.rows as IndividualReportRow[]} />}
          {kind === "team" && <TeamTable rows={report.rows as TeamReportRow[]} />}
        </section>
      )}
    </>
  );
}

function AgencyTable({ rows }: { rows: AgencyReportRow[] }) {
  if (rows.length === 0) return <p className="empty">No posted commission rows match these filters.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Paid Month</th>
          <th>Group</th>
          <th>Carrier</th>
          <th>LOB</th>
          <th>Premium</th>
          <th>Gross Commission</th>
          <th>Compensation Distributed</th>
          <th>Agency Net</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.groupId}-${row.carrierId}-${row.lineOfBusinessId}-${row.paidMonth}-${index}`}>
            <td>{formatStatementMonth(row.paidMonth)}</td>
            <td>{row.groupName}</td>
            <td>{row.carrierName}</td>
            <td>{row.lineOfBusinessName}</td>
            <td>{row.premiumCents == null ? "—" : formatCents(row.premiumCents)}</td>
            <td>{formatCents(row.grossCommissionCents)}</td>
            <td>{formatCents(row.compensationDistributedCents)}</td>
            <td>{formatCents(row.agencyNetCents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function IndividualTable({ rows }: { rows: IndividualReportRow[] }) {
  if (rows.length === 0) return <p className="empty">No posted recipient compensation matches these filters.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Paid Month</th>
          <th>Recipient</th>
          <th>Group</th>
          <th>Carrier</th>
          <th>LOB</th>
          <th>Gross Commission</th>
          <th>Applicable %</th>
          <th>Compensation Earned</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.personKind}-${row.personId}-${row.groupId}-${index}`}>
            <td>{formatStatementMonth(row.paidMonth)}</td>
            <td>{row.recipientName}{row.teamName ? ` · ${row.teamName}` : ""}</td>
            <td>{row.groupName}</td>
            <td>{row.carrierName}</td>
            <td>{row.lineOfBusinessName}</td>
            <td>{formatCents(row.grossCommissionCents)}</td>
            <td>{`${(row.allocationBps / 100).toFixed(row.allocationBps % 100 === 0 ? 0 : 2)}%`}</td>
            <td>{formatCents(row.compensationCents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TeamTable({ rows }: { rows: TeamReportRow[] }) {
  if (rows.length === 0) return <p className="empty">No posted team compensation matches these filters.</p>;
  return (
    <table>
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
            <td>{formatCents(row.grossCommissionCents)}</td>
            <td>{`${(row.teamAllocationBps / 100).toFixed(row.teamAllocationBps % 100 === 0 ? 0 : 2)}%`}</td>
            <td>{formatCents(row.teamCompensationCents)}</td>
            <td>{row.memberName}</td>
            <td>{formatCents(row.memberCompensationCents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
