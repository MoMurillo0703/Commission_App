import Link from "next/link";
import type { loadPersonWorkspace } from "@/data/peopleWorkspace";
import { formatStatementMonth } from "@/domain/dates";
import { teamParticipationLabel } from "@/domain/personCompensation";

type PersonWorkspace = Awaited<ReturnType<typeof loadPersonWorkspace>>;

export function PersonDetailWorkspace({ detail }: { detail: PersonWorkspace }) {
  const role = detail.personKind === "account_manager" ? "Account manager" : "Agent";
  return (
    <section className="panel">
      <p className="eyebrow"><Link href="/people">People</Link></p>
      <h2>{detail.person.name}</h2>
      <p>{role}. This identity is not merged with another person of the same name. Assignment is not compensation.</p>

      <h3>Overview</h3>
      <dl className="detail-list">
        <div><dt>Name</dt><dd>{detail.person.name}</dd></div>
        <div><dt>Role</dt><dd>{role}</dd></div>
        <div><dt>Identity</dt><dd>{detail.personKind}:{detail.person.id}</dd></div>
      </dl>

      <h3>Groups</h3>
      <p><strong>Primary Agent for</strong></p>
      {detail.primaryAgentFor.length === 0 ? <p className="muted-note">None.</p> : (
        <ul>
          {detail.primaryAgentFor.map((group) => (
            <li key={`pa-${group.id}`}><Link href={`/groups/${group.id}`}>{group.name}</Link></li>
          ))}
        </ul>
      )}
      <p><strong>Account Manager for</strong></p>
      {detail.accountManagerFor.length === 0 ? <p className="muted-note">None.</p> : (
        <ul>
          {detail.accountManagerFor.map((group) => (
            <li key={`am-${group.id}`}><Link href={`/groups/${group.id}`}>{group.name}</Link></li>
          ))}
        </ul>
      )}

      <h3>Compensation relationships</h3>
      <p className="muted-note">These rows come from actual allocations and overlapping team membership. They are not inferred from Group assignment.</p>
      {detail.compensation.length === 0 ? (
        <p className="empty">This person is not on an allocation.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Group</th>
              <th>LOB</th>
              <th>Role</th>
              <th>Split</th>
              <th>Effective</th>
            </tr>
          </thead>
          <tbody>
            {detail.compensation.map((row) => (
              <tr key={`${row.allocationId}-${row.recipientType}-${row.teamName ?? "direct"}`}>
                <td><Link href={`/groups/${row.groupId}`}>{row.groupName}</Link></td>
                <td>{row.lineOfBusinessName}</td>
                <td>{row.roleLabel}{row.teamName ? ` · ${row.teamName}` : ""}</td>
                <td>{teamParticipationLabel(row)}</td>
                <td>{formatStatementMonth(row.effectiveStart)} → {row.effectiveEnd ? formatStatementMonth(row.effectiveEnd) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Teams</h3>
      {detail.teams.length === 0 ? <p className="muted-note">No active overlapping team membership.</p> : (
        <ul>
          {detail.teams.map((team) => <li key={team.id}>{team.name}</li>)}
        </ul>
      )}

      <h3>Earnings</h3>
      <div className="form-actions">
        <Link className="secondary" href={detail.earningsHref} style={{ display: "inline-block", textDecoration: "none" }}>
          Open Individual Report
        </Link>
        {detail.agencyReportHref ? (
          <Link className="secondary" href={detail.agencyReportHref} style={{ display: "inline-block", textDecoration: "none" }}>
            Mo / Agency Report
          </Link>
        ) : null}
      </div>
    </section>
  );
}
