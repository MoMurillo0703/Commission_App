import { AppShell } from "@/components/AppShell";
import { CompensationWorkspace } from "@/components/CompensationWorkspace";
import { loadCompensationWorkspaceData } from "@/data/compensationWorkspaceLoad";
import { getDb } from "@/db";
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
  const db = await getDb();
  const loaded = await loadCompensationWorkspaceData(db, {
    ownerMonth,
    review: params.review === "1" && paidMonth
      ? { paidMonth, commissionIds: parseCommissionIds(params.commissionIds) }
      : null,
  });
  return (
    <AppShell active="compensation" reviewCount={loaded.reviewCount}>
      <header>
        <div>
          <p className="eyebrow">Compensation allocations</p>
          <h1>Compensation</h1>
          <p>Browse compensation by Group. Open a Group to see every Line of Coverage together. Posted payout snapshots stay unchanged.</p>
        </div>
      </header>
      <CompensationWorkspace
        groups={loaded.groups}
        agents={loaded.agents}
        accountManagers={loaded.accountManagers}
        linesOfBusiness={loaded.linesOfBusiness}
        initialAllocations={loaded.allocations}
        initialTeams={loaded.teams}
        initialQueue={loaded.initialQueue}
        groupLineEvidence={loaded.evidence}
        focusAllocationId={Number.isInteger(focusAllocationId) && focusAllocationId > 0 ? focusAllocationId : null}
        reviewContext={loaded.reviewCommissions.length > 0 ? {
          paidMonth,
          personName: params.personName ?? null,
          commissions: loaded.reviewCommissions,
        } : null}
        agencyOwner={loaded.agencyOwner}
        namedPeople={loaded.namedPeople}
        directory={loaded.directory}
      />
    </AppShell>
  );
}
