import { AgentsManager } from "@/components/AgentsManager";
import { AppShell } from "@/components/AppShell";
import { listAgreements } from "@/data/agreements";
import { listAgents } from "@/data/agents";
import { countUnassignedCommissions } from "@/data/commissions";
import { listGroups } from "@/data/groups";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  return (
    <AppShell active="agents" reviewCount={await countUnassignedCommissions()}>
      <header>
        <div>
          <p className="eyebrow">Reference data</p>
          <h1>Agents</h1>
          <p>Group assignment does not pay an agent. Compensation comes from dated group and line-of-business agreements.</p>
        </div>
      </header>
      <AgentsManager initial={await listAgents()} groups={await listGroups()} agreements={await listAgreements()} />
    </AppShell>
  );
}
