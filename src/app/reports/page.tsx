import { AppShell } from "@/components/AppShell";
import { countUnassignedCommissions } from "@/data/commissions";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  return (
    <AppShell active="reports" reviewCount={await countUnassignedCommissions()}>
      <header>
        <div>
          <p className="eyebrow">Reporting</p>
          <h1>Reports</h1>
          <p>Dedicated month, group, carrier, line of business, and agent reports are not built yet. Use Overview and Statements for current posted totals.</p>
        </div>
      </header>
      <section className="panel">
        <p className="empty">This page is a placeholder so Reports stays visible in navigation. Missing-commission reporting is out of scope for this demo round.</p>
      </section>
    </AppShell>
  );
}
