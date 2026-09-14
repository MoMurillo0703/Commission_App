import type { AppDatabase } from "@/db";
import { listAccountManagers } from "./accountManagers";
import { getAgencyOwnerForPaidMonth } from "./agencyOwner";
import { listAgents } from "./agents";
import { listAllocations } from "./allocations";
import { namedBusinessPeople } from "./businessCompensation";
import { classifyCompensationGroups } from "@/domain/businessCompensation";
import { missingLinesForGroup } from "@/domain/compensationHome";
import { countUnassignedCommissions, listPostedGroupLobMonths } from "./commissions";
import { listPostedCompensationExceptions } from "./compensationExceptions";
import { listGroupCompensationQueue } from "./compensationQueue";
import { listCarriers } from "./carriers";
import { listGroups } from "./groups";
import { listGroupLineEvidence } from "./groupLineEvidence";
import { listLinesOfBusiness } from "./linesOfBusiness";
import { listTeams } from "./teams";
import { listPostedGroupLineCarriers, projectCompensationDirectory } from "./compensationDirectory";

export async function loadCompensationWorkspaceData(
  db: AppDatabase,
  input: {
    ownerMonth: string;
    review?: { paidMonth: string; commissionIds?: number[] } | null;
  },
) {
  // Sequential on purpose: a wide Promise.all against the transaction pooler
  // (postgres.js max 10) never drains and holds connections after abort.
  const agents = await listAgents(db);
  const accountManagers = await listAccountManagers(db);
  const groups = await listGroups(db);
  const linesOfBusiness = await listLinesOfBusiness(db);
  const allocations = await listAllocations(db);
  const teams = await listTeams(db);
  const evidence = await listGroupLineEvidence(db);
  const postedCarriers = await listPostedGroupLineCarriers(db);
  const carriers = await listCarriers(db);
  const agencyOwner = await getAgencyOwnerForPaidMonth(db, input.ownerMonth);
  const reviewCount = await countUnassignedCommissions(db);
  const reviewCommissions = input.review
    ? await listPostedCompensationExceptions(db, input.review)
    : [];
  const posted = await listPostedGroupLobMonths(db);
  const compensationDirectory = projectCompensationDirectory({
    groups,
    allocations,
    evidence,
    lines: linesOfBusiness,
    agents,
    accountManagers,
    postedCarriers,
    asOfMonth: input.ownerMonth,
    owner: agencyOwner,
    teams,
  });
  const missingLineCounts = Object.fromEntries(groups.map((group) => [
    group.id,
    missingLinesForGroup(group.id, evidence, linesOfBusiness, allocations).length,
  ]));
  const directory = classifyCompensationGroups({
    groups,
    summaries: groups.map((group) => {
      const active = allocations.filter((row) => row.groupId === group.id && row.status === "active");
      return {
        groupId: group.id,
        groupName: group.name,
        activeAllocationCount: active.length,
        currentLineNames: [...new Set(active.map((row) => row.lineOfBusinessName))],
      };
    }),
    missingLineCounts,
    exceptionGroupIds: [],
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
    carriers,
    agencyOwner,
    reviewCount,
    reviewCommissions,
    directory,
    compensationDirectory,
    initialQueue,
    namedPeople: namedBusinessPeople(agents, accountManagers, agencyOwner),
  };
}
