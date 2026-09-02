import { AppShell } from "@/components/AppShell";
import { GroupsWorkspace } from "@/components/GroupsWorkspace";
import { listAccountManagers } from "@/data/accountManagers";
import { listAgreements } from "@/data/agreements";
import { listAgents } from "@/data/agents";
import { countUnassignedCommissions } from "@/data/commissions";
import { listGroups } from "@/data/groups";
import { listLinesOfBusiness } from "@/data/linesOfBusiness";

export const dynamic = "force-dynamic";

export default async function GroupsPage() {
  return (
    <AppShell active="groups" reviewCount={await countUnassignedCommissions()}>
      <header>
        <div>
          <p className="eyebrow">Reference data</p>
          <h1>Groups</h1>
          <p>Assign an account manager and primary agent. Compensation is a separate dated agreement by group, agent, and line of business.</p>
        </div>
      </header>
      <GroupsWorkspace
        groups={await listGroups()}
        accountManagers={await listAccountManagers()}
        agents={await listAgents()}
        linesOfBusiness={await listLinesOfBusiness()}
        agreements={await listAgreements()}
      />
    </AppShell>
  );
}
