import type { AppDatabase } from "@/db";
import { listAccountManagers } from "./accountManagers";
import { getAgencyOwnerForPaidMonth } from "./agencyOwner";
import { listAgents } from "./agents";
import { listAllocations } from "./allocations";
import { buildCompensationDirectory, namedBusinessPeople } from "./businessCompensation";
import { countUnassignedCommissions, listCommissions, listPostedGroupLobMonths } from "./commissions";
import { listCorrectedCommissionIds } from "./compensationCorrections";
import { listPostedCompensationExceptions } from "./compensationExceptions";
import { listGroupCompensationQueue } from "./compensationQueue";
import { listGroups } from "./groups";
import { listGroupLineEvidence } from "./groupLineEvidence";
import { listLinesOfBusiness } from "./linesOfBusiness";
import { listAllPayouts } from "./payouts";
import { listTeams } from "./teams";

export async function loadCompensationWorkspaceData(
  db: AppDatabase,
  input: {
    ownerMonth: string;
    review?: { paidMonth: string; commissionIds?: number[] } | null;
  },
) {
  // Sequential on purpose: a 14-way Promise.all against the transaction pooler
  // (postgres.js max 10) never drains and holds connections after abort.
  const agents = await listAgents(db);
  const accountManagers = await listAccountManagers(db);
  const groups = await listGroups(db);
  const linesOfBusiness = await listLinesOfBusiness(db);
  const allocations = await listAllocations(db);
  const teams = await listTeams(db);
  const evidence = await listGroupLineEvidence(db);
  const commissions = await listCommissions(db);
  const payouts = await listAllPayouts(db);
  const corrected = await listCorrectedCommissionIds(db);
  const posted = await listPostedGroupLobMonths(db);
  const agencyOwner = await getAgencyOwnerForPaidMonth(db, input.ownerMonth);
  const reviewCount = await countUnassignedCommissions(db);
  const reviewCommissions = input.review
    ? await listPostedCompensationExceptions(db, input.review)
    : [];
  const directory = await buildCompensationDirectory(db, {
    groups,
    allocations,
    evidence,
    lines: linesOfBusiness,
    commissions,
    payouts,
    corrected,
  });
  const initialQueue = await listGroupCompensationQueue(db, {
    groups,
    linesOfBusiness,
    allocations,
    posted,
  });
  return {
    agents,
    accountManagers,
    groups,
    linesOfBusiness,
    allocations,
    teams,
    evidence,
    agencyOwner,
    reviewCount,
    reviewCommissions,
    directory,
    initialQueue,
    namedPeople: namedBusinessPeople(agents, accountManagers, agencyOwner),
  };
}
