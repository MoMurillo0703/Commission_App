import { AppShell } from "@/components/AppShell";
import { PeopleWorkspace } from "@/components/PeopleWorkspace";
import { listAccountManagers } from "@/data/accountManagers";
import { listAgreements } from "@/data/agreements";
import { listAgents } from "@/data/agents";
import { countUnassignedCommissions } from "@/data/commissions";
import { listGroups } from "@/data/groups";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  return <AppShell active="people" reviewCount={await countUnassignedCommissions()}><header><div><p className="eyebrow">Assignments</p><h1>People</h1><p>Search agents and account managers, then maintain each role and its group relationships.</p></div></header><PeopleWorkspace agents={await listAgents()} accountManagers={await listAccountManagers()} groups={await listGroups()} agreements={await listAgreements()} /></AppShell>;
}
