import { AppShell } from "@/components/AppShell";
import { StatementsWorkspace } from "@/components/StatementsWorkspace";
import { listAgreements } from "@/data/agreements";
import { listAgents } from "@/data/agents";
import { listCarriers } from "@/data/carriers";
import { countUnassignedCommissions, listCommissions } from "@/data/commissions";
import { listGroups } from "@/data/groups";
import { listLinesOfBusiness } from "@/data/linesOfBusiness";
import { listImportPaidMonths, listImportStatements } from "@/data/statements";
import { currentPaidMonth, paidMonthPattern } from "@/domain/dates";

export const dynamic = "force-dynamic";

export default async function StatementsPage({ searchParams }: { searchParams: Promise<{ paidMonth?: string }> }) {
  const requestedMonth = (await searchParams).paidMonth;
  const paidMonth = requestedMonth && paidMonthPattern.test(requestedMonth) ? requestedMonth : currentPaidMonth();

  return (
    <AppShell active="statements" reviewCount={await countUnassignedCommissions()}>
      <StatementsWorkspace
        initialPaidMonth={paidMonth}
        initialStatements={await listImportStatements(paidMonth)}
        availablePaidMonths={await listImportPaidMonths()}
        commissions={await listCommissions()}
        groups={await listGroups()}
        carriers={await listCarriers()}
        linesOfBusiness={await listLinesOfBusiness()}
        agents={await listAgents()}
        agreements={await listAgreements()}
      />
    </AppShell>
  );
}
