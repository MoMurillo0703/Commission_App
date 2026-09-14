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
  const asOfMonth = isPaidMonth(paidMonth) ? paidMonth : currentPaidMonth();
  const db = await getDb();
  const loaded = await loadCompensationWorkspaceData(db, {
    ownerMonth: asOfMonth,
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
          <p>Filter Groups and lines, select matching targets, apply a people split or template, preview, and commit once. Current unpaid earnings use those effective-dated terms.</p>
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
        compensationDirectory={loaded.compensationDirectory}
        carriers={loaded.carriers}
        initialAsOfMonth={asOfMonth}
      />
    </AppShell>
  );
}
