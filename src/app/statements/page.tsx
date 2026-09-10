import { AppShell } from "@/components/AppShell";
import { StatementsWorkspace } from "@/components/StatementsWorkspace";
import { listAgreements } from "@/data/agreements";
import { listAgents } from "@/data/agents";
import { listCarriers } from "@/data/carriers";
import { countUnassignedCommissions, listCommissions } from "@/data/commissions";
import { listGroups } from "@/data/groups";
import { listLinesOfBusiness } from "@/data/linesOfBusiness";
import { listImportPaidMonths, listImportStatements } from "@/data/statements";
import { getDb } from "@/db";
import { currentPaidMonth, paidMonthPattern } from "@/domain/dates";

export const dynamic = "force-dynamic";

export default async function StatementsPage({ searchParams }: { searchParams: Promise<{ paidMonth?: string }> }) {
  const requestedMonth = (await searchParams).paidMonth;
  const paidMonth = requestedMonth && paidMonthPattern.test(requestedMonth) ? requestedMonth : currentPaidMonth();
  const db = await getDb();
  const [reviewCount, initialStatements, availablePaidMonths, commissions, groups, carriers, linesOfBusiness, agents, agreements] = await Promise.all([
    countUnassignedCommissions(db),
    listImportStatements(paidMonth, db),
    listImportPaidMonths(db),
    listCommissions(db),
    listGroups(db),
    listCarriers(db),
    listLinesOfBusiness(db),
    listAgents(db),
    listAgreements(db),
  ]);

  return (
    <AppShell active="statements" reviewCount={reviewCount}>
      <StatementsWorkspace
        initialPaidMonth={paidMonth}
        initialStatements={initialStatements}
        availablePaidMonths={availablePaidMonths}
        commissions={commissions}
        groups={groups}
        carriers={carriers}
        linesOfBusiness={linesOfBusiness}
        agents={agents}
        agreements={agreements}
      />
    </AppShell>
  );
}
