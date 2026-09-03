import { AppShell } from "@/components/AppShell";
import { GroupCompensationManager } from "@/components/GroupCompensationManager";
import { listAgreements } from "@/data/agreements";
import { listAccountManagers } from "@/data/accountManagers";
import { listAgents } from "@/data/agents";
import { countUnassignedCommissions } from "@/data/commissions";
import { listGroups } from "@/data/groups";
import { listLinesOfBusiness } from "@/data/linesOfBusiness";

export const dynamic = "force-dynamic";

export default async function CompensationPage() {
  const groups = await listGroups();
  return <AppShell active="compensation" reviewCount={await countUnassignedCommissions()}><header><div><p className="eyebrow">Agent compensation</p><h1>Compensation</h1><p>Maintain effective-dated splits by group, agent, and line of business. Historical commission snapshots remain unchanged.</p></div></header><GroupCompensationManager groups={groups} agents={await listAgents()} accountManagers={await listAccountManagers()} linesOfBusiness={await listLinesOfBusiness()} initial={await listAgreements()} selectedGroupId={null} /></AppShell>;
}
