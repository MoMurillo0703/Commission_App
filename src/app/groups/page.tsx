import { AppShell } from "@/components/AppShell";
import { GroupsManager } from "@/components/GroupsManager";
import { listAccountManagers } from "@/data/accountManagers";
import { listAgents } from "@/data/agents";
import { countUnassignedCommissions } from "@/data/commissions";
import { listGroups } from "@/data/groups";
import { getDb } from "@/db";

export const dynamic = "force-dynamic";

export default async function GroupsPage() {
  const db = await getDb();
  const [reviewCount, groups, accountManagers, agents] = await Promise.all([
    countUnassignedCommissions(db),
    listGroups(db),
    listAccountManagers(db),
    listAgents(db),
  ]);
  return (
    <AppShell active="groups" reviewCount={reviewCount}>
      <header>
        <div>
          <p className="eyebrow">Reference data</p>
          <h1>Groups</h1>
          <p>Maintain group names, identifiers, and primary assignments. Compensation terms are managed separately.</p>
        </div>
      </header>
      <GroupsManager
        initial={groups}
        accountManagers={accountManagers}
        agents={agents}
        selectedId={null}
      />
    </AppShell>
  );
}
