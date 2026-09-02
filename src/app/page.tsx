import Link from "next/link";
import { AddStatementButton } from "@/components/AddStatementButton";
import { AppShell } from "@/components/AppShell";
import { StatementIntake } from "@/components/StatementIntake";
import { listCarriers } from "@/data/carriers";
import { getOverview } from "@/data/overview";
import { listImportStatements } from "@/data/statements";
import { currentPaidMonth, formatStatementMonth } from "@/domain/dates";
import { formatCents } from "@/domain/money";

export const dynamic = "force-dynamic";

export default async function Home() {
  const overview = await getOverview();
  const paidMonth = currentPaidMonth();
  const money = (cents: number) => formatCents(cents, 0);

  return (
    <AppShell active="overview" reviewCount={overview.needsReview}>
      <header>
        <div>
          <p className="eyebrow">Agency workspace</p>
          <h1>Commission overview</h1>
          <p>Track carrier statements, group production, and agent assignments.</p>
        </div>
        <AddStatementButton />
      </header>
      <div className="stats">
        <Card label="Commission paid" value={money(overview.grossCommissionCents)} note={overview.grossCommissionCents ? "Posted commission records" : "No commissions posted yet"} />
        <Card label="Reported premium" value={money(overview.premiumCents)} note="Where supplied by carrier" />
        <Card label="Active groups" value={String(overview.groupCount)} note={overview.lineOfBusinessCount ? `Across ${overview.lineOfBusinessCount} product lines` : "No groups on file yet"} />
        <Card label="Needs review" value={String(overview.needsReview)} note="Unassigned or unmatched" warning />
      </div>
      <div className="grid">
        <StatementIntake
          initialPaidMonth={paidMonth}
          initialStatements={await listImportStatements(paidMonth)}
          carriers={await listCarriers()}
        />
        <section className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">By agent</p>
              <h2>Production</h2>
            </div>
            <Link href="/agents">View agents →</Link>
          </div>
          {overview.agents.length === 0 ? (
            <p className="empty">No commission records yet. Add reference data, then record a commission.</p>
          ) : (
            overview.agents.map((agent) => (
              <div key={agent.key} className={`agent${agent.unassigned ? " alert" : ""}`}>
                <span>{agent.initials}</span>
                <div>
                  <strong>{agent.agentName}</strong>
                  <small>
                    {agent.groupCount} {agent.groupCount === 1 ? "group" : "groups"}
                    {agent.lines.length ? ` · ${agent.lines.join(", ")}` : ""}
                    {agent.unassigned ? " · needs an owner" : ""}
                  </small>
                </div>
                <b>{money(agent.grossCommissionCents)}</b>
              </div>
            ))
          )}
        </section>
      </div>
      <section className="panel recent">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Recent activity</p>
            <h2>Carrier statements</h2>
          </div>
          <Link href="/statements">All statements →</Link>
        </div>
        {overview.statements.length === 0 ? (
          <p className="empty">No statements posted yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Carrier</th>
                <th>Period</th>
                <th>Lines</th>
                <th>Groups</th>
                <th>Commission</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {overview.statements.map((statement) => (
                <tr key={statement.key}>
                  <td>
                    <strong>{statement.carrierName}</strong>
                  </td>
                  <td>{formatStatementMonth(statement.statementMonth)}</td>
                  <td>{statement.lines.join(", ")}</td>
                  <td>{statement.groupCount}</td>
                  <td>{money(statement.grossCommissionCents)}</td>
                  <td>
                    <span className={`pill ${statement.needsReview ? "review" : "posted"}`}>{statement.needsReview ? "Review" : "Posted"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </AppShell>
  );
}

function Card({ label, value, note, warning = false }: { label: string; value: string; note: string; warning?: boolean }) {
  return (
    <article className={`card ${warning ? "warning" : ""}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}
