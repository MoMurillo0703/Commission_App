import { AppShell } from "@/components/AppShell";
import { CompensationWorkspace } from "@/components/CompensationWorkspace";
import { listAccountManagers } from "@/data/accountManagers";
import { listAgents } from "@/data/agents";
import { listAllocations } from "@/data/allocations";
import { countUnassignedCommissions, listCommissions, listPostedGroupLobMonths } from "@/data/commissions";
import { listCorrectedCommissionIds } from "@/data/compensationCorrections";
import { listPostedCompensationExceptions } from "@/data/compensationExceptions";
import { listGroupCompensationQueue } from "@/data/compensationQueue";
import { listGroups } from "@/data/groups";
import { listLinesOfBusiness } from "@/data/linesOfBusiness";
import { listGroupLineEvidence } from "@/data/groupLineEvidence";
import { listAllPayouts } from "@/data/payouts";
import { listTeams } from "@/data/teams";
import { getAgencyOwnerForPaidMonth } from "@/data/agencyOwner";
import { buildCompensationDirectory, namedBusinessPeople } from "@/data/businessCompensation";
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
  const [
    agents,
    accountManagers,
    groups,
    linesOfBusiness,
    allocations,
    teams,
    evidence,
    commissions,
    payouts,
    corrected,
    posted,
    agencyOwner,
    reviewCount,
    reviewCommissions,
  ] = await Promise.all([
    listAgents(db),
    listAccountManagers(db),
    listGroups(db),
    listLinesOfBusiness(db),
    listAllocations(db),
    listTeams(db),
    listGroupLineEvidence(db),
    listCommissions(db),
    listAllPayouts(db),
    listCorrectedCommissionIds(db),
    listPostedGroupLobMonths(db),
    getAgencyOwnerForPaidMonth(db, ownerMonth),
    countUnassignedCommissions(db),
    params.review === "1" && paidMonth
      ? listPostedCompensationExceptions(db, {
        paidMonth,
        commissionIds: parseCommissionIds(params.commissionIds),
      })
      : Promise.resolve([]),
  ]);
  const [directory, initialQueue] = await Promise.all([
    buildCompensationDirectory(db, {
      groups,
      allocations,
      evidence,
      lines: linesOfBusiness,
      commissions,
      payouts,
      corrected,
    }),
    listGroupCompensationQueue(db, { groups, linesOfBusiness, allocations, posted }),
  ]);
  return (
    <AppShell active="compensation" reviewCount={reviewCount}>
      <header>
        <div>
          <p className="eyebrow">Compensation allocations</p>
          <h1>Compensation</h1>
          <p>Browse compensation by Group. Open a Group to see every Line of Coverage together. Posted payout snapshots stay unchanged.</p>
        </div>
      </header>
      <CompensationWorkspace
        groups={groups}
        agents={agents}
        accountManagers={accountManagers}
        linesOfBusiness={linesOfBusiness}
        initialAllocations={allocations}
        initialTeams={teams}
        initialQueue={initialQueue}
        groupLineEvidence={evidence}
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
