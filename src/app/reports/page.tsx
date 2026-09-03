import { AppShell } from "@/components/AppShell";
import { ReportsWorkspace } from "@/components/ReportsWorkspace";
import { listAccountManagers } from "@/data/accountManagers";
import { listAgents } from "@/data/agents";
import { listCarriers } from "@/data/carriers";
import { countUnassignedCommissions } from "@/data/commissions";
import { listGroups } from "@/data/groups";
import { listLinesOfBusiness } from "@/data/linesOfBusiness";
import { listTeams } from "@/data/teams";
import { buildAgencyReport } from "@/data/reports";
import { agencyReportDocument } from "@/domain/reportDocuments";
import { reportEmptyMessage } from "@/domain/reportDiscovery";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const initial = await buildAgencyReport(undefined, { kind: "agency" });
  const document = agencyReportDocument(initial.rows, initial.totals, initial.filters, initial.names);
  return (
    <AppShell active="reports" reviewCount={await countUnassignedCommissions()}>
      <header>
        <div>
          <p className="eyebrow">Reporting</p>
          <h1>Reports</h1>
          <p>Posted commission reports by paid month, group, carrier, line of business, recipient, and team. Totals use historical snapshots, not today’s current splits.</p>
        </div>
      </header>
      <ReportsWorkspace
        groups={await listGroups()}
        carriers={await listCarriers()}
        linesOfBusiness={await listLinesOfBusiness()}
        agents={await listAgents()}
        accountManagers={await listAccountManagers()}
        teams={await listTeams()}
        initialReport={{
          ...initial,
          document,
          emptyMessage: reportEmptyMessage(initial.filters, initial.availability),
        }}
      />
    </AppShell>
  );
}
