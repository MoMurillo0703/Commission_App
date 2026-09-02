"use client";

import { useState } from "react";
import { CommissionsManager } from "@/components/CommissionsManager";
import { StatementIntake } from "@/components/StatementIntake";
import type { AgreementView } from "@/data/agreements";
import type { CommissionView } from "@/data/commissions";
import type { ImportStatementView } from "@/data/statements";
import type { Agent, Carrier, Group, LineOfBusiness } from "@/db/schema";
import { formatPaidMonthTitle } from "@/domain/dates";

export function StatementsWorkspace({
  initialPaidMonth,
  initialStatements,
  commissions,
  groups,
  carriers,
  linesOfBusiness,
  agents,
  agreements,
}: {
  initialPaidMonth: string;
  initialStatements: ImportStatementView[];
  commissions: CommissionView[];
  groups: Group[];
  carriers: Carrier[];
  linesOfBusiness: LineOfBusiness[];
  agents: Agent[];
  agreements: AgreementView[];
}) {
  const [paidMonth, setPaidMonth] = useState(initialPaidMonth);

  return (
    <>
      <header>
        <div>
          <p className="eyebrow">Paid commissions</p>
          <h1>{formatPaidMonthTitle(paidMonth)}</h1>
          <p>Statements and files for the month the agency received payment. Coverage month stays separate when the carrier provides it.</p>
        </div>
      </header>
      <StatementIntake
        initialPaidMonth={initialPaidMonth}
        initialStatements={initialStatements}
        carriers={carriers}
        onPaidMonthChange={setPaidMonth}
      />
      <div className="recent">
        <CommissionsManager
          initial={commissions}
          groups={groups}
          carriers={carriers}
          linesOfBusiness={linesOfBusiness}
          agents={agents}
          agreements={agreements}
        />
      </div>
    </>
  );
}
