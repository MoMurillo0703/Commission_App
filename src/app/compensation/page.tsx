import { AppShell } from "@/components/AppShell";
import { CompensationWorkspace } from "@/components/CompensationWorkspace";
import { listAccountManagers } from "@/data/accountManagers";
import { listAgents } from "@/data/agents";
import { listAllocations } from "@/data/allocations";
import { countUnassignedCommissions } from "@/data/commissions";
import { listPostedCompensationExceptions } from "@/data/compensationExceptions";
import { listGroupCompensationQueue } from "@/data/compensationQueue";
import { listGroups } from "@/data/groups";
import { listLinesOfBusiness } from "@/data/linesOfBusiness";
import { listGroupLineEvidence } from "@/data/groupLineEvidence";
import { listTeams } from "@/data/teams";
import { getAgencyOwnerForPaidMonth } from "@/data/agencyOwner";
import { buildCompensationDirectory, namedBusinessPeople } from "@/data/businessCompensation";
import { parseCommissionIds } from "@/domain/compensationExceptions";
import { currentPaidMonth, isPaidMonth } from "@/domain/dates";

export const dynamic = "force-dynamic";

export default async function CompensationPage({
  searchParams,
}: {
  searchParams?: Promise<{
    allocationId?: string;
    review?: string;
    paidMonth?: string;
    commissionIds?: string;
    personKind?: string;
    personId?: string;
    personName?: string;
  }>;
}) {
  const params = searchParams ? await searchParams : {};
  const focusAllocationId = Number(params.allocationId);
  const paidMonth = params.paidMonth ?? "";
  const ownerMonth = isPaidMonth(paidMonth) ? paidMonth : currentPaidMonth();
  const [agents, accountManagers, directory, agencyOwner] = await Promise.all([
    listAgents(),
    listAccountManagers(),
    buildCompensationDirectory(),
    getAgencyOwnerForPaidMonth(undefined, ownerMonth),
  ]);
  const reviewCommissions = params.review === "1" && paidMonth
    ? await listPostedCompensationExceptions(undefined, {
      paidMonth,
      commissionIds: parseCommissionIds(params.commissionIds),
    })
    : [];
  return (
    <AppShell active="compensation" reviewCount={await countUnassignedCommissions()}>
      <header>
        <div>
          <p className="eyebrow">Compensation allocations</p>
          <h1>Compensation</h1>
          <p>Browse compensation by Group. Open a Group to see every Line of Coverage together. Posted payout snapshots stay unchanged.</p>
        </div>
      </header>
      <CompensationWorkspace
        groups={await listGroups()}
        agents={agents}
        accountManagers={accountManagers}
        linesOfBusiness={await listLinesOfBusiness()}
        initialAllocations={await listAllocations()}
        initialTeams={await listTeams()}
        initialQueue={await listGroupCompensationQueue()}
        groupLineEvidence={await listGroupLineEvidence()}
        focusAllocationId={Number.isInteger(focusAllocationId) && focusAllocationId > 0 ? focusAllocationId : null}
        reviewContext={reviewCommissions.length > 0 ? {
          paidMonth,
          personName: params.personName ?? null,
          commissions: reviewCommissions,
        } : null}
        agencyOwner={agencyOwner}
        namedPeople={namedBusinessPeople(agents, accountManagers, agencyOwner)}
        directory={directory}
      />
    </AppShell>
  );
}
