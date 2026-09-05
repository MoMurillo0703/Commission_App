import { AppShell } from "@/components/AppShell";
import { CompensationWorkspace } from "@/components/CompensationWorkspace";
import { listAccountManagers } from "@/data/accountManagers";
import { listAgents } from "@/data/agents";
import { listAllocations } from "@/data/allocations";
import { countUnassignedCommissions } from "@/data/commissions";
import { listCompensationQueue } from "@/data/compensationQueue";
import { listGroups } from "@/data/groups";
import { listLinesOfBusiness } from "@/data/linesOfBusiness";
import { listGroupLineEvidence } from "@/data/groupLineEvidence";
import { listTeams } from "@/data/teams";

export const dynamic = "force-dynamic";

export default async function CompensationPage({
  searchParams,
}: {
  searchParams?: Promise<{ allocationId?: string }>;
}) {
  const params = searchParams ? await searchParams : {};
  const focusAllocationId = Number(params.allocationId);
  return (
    <AppShell active="compensation" reviewCount={await countUnassignedCommissions()}>
      <header>
        <div>
          <p className="eyebrow">Compensation allocations</p>
          <h1>Compensation</h1>
          <p>Manage complete 100% allocations by group and line of business. Agency, people, and teams are recipients. Historical posted snapshots stay unchanged.</p>
        </div>
      </header>
      <CompensationWorkspace
        groups={await listGroups()}
        agents={await listAgents()}
        accountManagers={await listAccountManagers()}
        linesOfBusiness={await listLinesOfBusiness()}
        initialAllocations={await listAllocations()}
        initialTeams={await listTeams()}
        initialQueue={await listCompensationQueue()}
        groupLineEvidence={await listGroupLineEvidence()}
        focusAllocationId={Number.isInteger(focusAllocationId) && focusAllocationId > 0 ? focusAllocationId : null}
      />
    </AppShell>
  );
}
