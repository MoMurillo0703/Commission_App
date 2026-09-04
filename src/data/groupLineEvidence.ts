import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { commissionRecords, compensationAllocations, groupCompensationAgreements } from "@/db/schema";
import type { GroupLineEvidence } from "@/domain/activeGroupLines";

export async function listGroupLineEvidence(db?: AppDatabase): Promise<GroupLineEvidence[]> {
  const database = await resolveDb(db);
  const [fromCommissions, fromAllocations, fromAgreements] = await Promise.all([
    database.select({
      groupId: commissionRecords.groupId,
      lineOfBusinessId: commissionRecords.lineOfBusinessId,
    }).from(commissionRecords),
    database.select({
      groupId: compensationAllocations.groupId,
      lineOfBusinessId: compensationAllocations.lineOfBusinessId,
    }).from(compensationAllocations),
    database.select({
      groupId: groupCompensationAgreements.groupId,
      lineOfBusinessId: groupCompensationAgreements.lineOfBusinessId,
    }).from(groupCompensationAgreements),
  ]);
  return [...fromCommissions, ...fromAllocations, ...fromAgreements];
}
