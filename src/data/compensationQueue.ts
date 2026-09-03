import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { currentPaidMonth } from "@/domain/dates";
import { identifyCompensationQueue, queueAllocationCandidates } from "@/domain/compensationQueue";
import { listAllocations } from "./allocations";
import { listPostedGroupLobMonths } from "./commissions";
import { listGroups } from "./groups";
import { listLinesOfBusiness } from "./linesOfBusiness";

export async function listCompensationQueue(db?: AppDatabase) {
  const database = await resolveDb(db);
  const [groups, linesOfBusiness, allocations, posted] = await Promise.all([
    listGroups(database),
    listLinesOfBusiness(database),
    listAllocations(database),
    listPostedGroupLobMonths(database),
  ]);
  return identifyCompensationQueue({
    groups,
    linesOfBusiness,
    allocations: queueAllocationCandidates(allocations),
    posted,
    asOfMonth: currentPaidMonth(),
  });
}
