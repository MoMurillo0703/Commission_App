import { AppShell } from "@/components/AppShell";
import { ReportsWorkspace } from "@/components/ReportsWorkspace";
import { listAccountManagers } from "@/data/accountManagers";
import { listAgents } from "@/data/agents";
import { listCarriers } from "@/data/carriers";
import { countUnassignedCommissions } from "@/data/commissions";
import { listGroups } from "@/data/groups";
import { listLinesOfBusiness } from "@/data/linesOfBusiness";
import { listTeams } from "@/data/teams";
import { getDb } from "@/db";
import { parseReportsSearchParams } from "@/domain/reportDeepLink";

export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams?: Promise<{
    kind?: string;
    personKey?: string;
    personKind?: string;
    personId?: string;
    paidMonth?: string;
    groupId?: string;
  }>;
}) {
  const db = await getDb();
  const params = searchParams ? await searchParams : {};
  const [reviewCount, groups, carriers, linesOfBusiness, agents, accountManagers, teams] = await Promise.all([
    countUnassignedCommissions(db),
    listGroups(db),
    listCarriers(db),
    listLinesOfBusiness(db),
    listAgents(db),
    listAccountManagers(db),
    listTeams(db),
  ]);
  return (
    <AppShell active="reports" reviewCount={reviewCount}>
      <header>
        <div>
          <p className="eyebrow">Reporting</p>
          <h1>Reports</h1>
          <p>Generate an Individual Commission Report from posted payouts. Choose a recipient and paid month, then run the report or download the PDF. Generating a report does not mark anyone paid.</p>
        </div>
      </header>
      <ReportsWorkspace
        groups={groups}
        carriers={carriers}
        linesOfBusiness={linesOfBusiness}
        agents={agents}
        accountManagers={accountManagers}
        teams={teams}
        initialFilters={parseReportsSearchParams(params)}
      />
    </AppShell>
  );
}
