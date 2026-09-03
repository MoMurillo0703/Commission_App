import { AppShell } from "@/components/AppShell";
import { GroupsManager } from "@/components/GroupsManager";
import { listAccountManagers } from "@/data/accountManagers";
import { listAgents } from "@/data/agents";
import { countUnassignedCommissions } from "@/data/commissions";
import { listGroups } from "@/data/groups";

export const dynamic = "force-dynamic";

export default async function GroupsPage() {
  return (
    <AppShell active="groups" reviewCount={await countUnassignedCommissions()}>
      <header>
        <div>
          <p className="eyebrow">Reference data</p>
          <h1>Groups</h1>
          <p>Maintain group names, identifiers, and primary assignments. Compensation terms are managed separately.</p>
        </div>
      </header>
      <GroupsManager
        initial={await listGroups()}
        accountManagers={await listAccountManagers()}
        agents={await listAgents()}
        selectedId={null}
      />
    </AppShell>
  );
}
