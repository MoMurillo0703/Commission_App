import { AppShell } from "@/components/AppShell";
import { PeopleWorkspace } from "@/components/PeopleWorkspace";
import { listAccountManagers } from "@/data/accountManagers";
import { listAgreements } from "@/data/agreements";
import { listAgents } from "@/data/agents";
import { listAllocations } from "@/data/allocations";
import { countUnassignedCommissions } from "@/data/commissions";
import { listGroups } from "@/data/groups";
import { listTeams } from "@/data/teams";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  return (
    <AppShell active="people" reviewCount={await countUnassignedCommissions()}>
      <header>
        <div>
          <p className="eyebrow">Assignments</p>
          <h1>People</h1>
          <p>Search a person to see their compensation splits, then edit the complete Group + LOB allocation. Assignment is separate from compensation.</p>
        </div>
      </header>
      <PeopleWorkspace
        agents={await listAgents()}
        accountManagers={await listAccountManagers()}
        groups={await listGroups()}
        agreements={await listAgreements()}
        allocations={await listAllocations()}
        teams={await listTeams()}
      />
    </AppShell>
  );
}
