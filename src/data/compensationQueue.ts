import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { currentPaidMonth } from "@/domain/dates";
import { groupCompensationQueue, identifyCompensationQueue, queueAllocationCandidates } from "@/domain/compensationQueue";
import { listAllocations } from "./allocations";
import { listPostedGroupLobMonths } from "./commissions";
import { listGroups } from "./groups";
import { listLinesOfBusiness } from "./linesOfBusiness";

export type CompensationQueueSources = {
  groups?: Awaited<ReturnType<typeof listGroups>>;
  linesOfBusiness?: Awaited<ReturnType<typeof listLinesOfBusiness>>;
  allocations?: Awaited<ReturnType<typeof listAllocations>>;
  posted?: Awaited<ReturnType<typeof listPostedGroupLobMonths>>;
};

export async function listCompensationQueue(db?: AppDatabase, sources: CompensationQueueSources = {}) {
  const database = await resolveDb(db);
  const [groups, linesOfBusiness, allocations, posted] = await Promise.all([
    sources.groups ? Promise.resolve(sources.groups) : listGroups(database),
    sources.linesOfBusiness ? Promise.resolve(sources.linesOfBusiness) : listLinesOfBusiness(database),
    sources.allocations ? Promise.resolve(sources.allocations) : listAllocations(database),
    sources.posted ? Promise.resolve(sources.posted) : listPostedGroupLobMonths(database),
  ]);
  return identifyCompensationQueue({
    groups,
    linesOfBusiness,
    allocations: queueAllocationCandidates(allocations),
    posted,
    asOfMonth: currentPaidMonth(),
  });
}

export async function listGroupCompensationQueue(db?: AppDatabase, sources: CompensationQueueSources = {}) {
  return groupCompensationQueue(await listCompensationQueue(db, sources));
}
