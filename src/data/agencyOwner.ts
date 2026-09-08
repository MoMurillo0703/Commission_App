import {
  agencyOwnerForPaidMonth,
  ownerIdentityFromFks,
  type AgencyCompensationOwnerPeriod,
  type PersonIdentity,
} from "@/domain/agencyOwner";
import { isPaidMonth } from "@/domain/dates";
import type { AppDatabase } from "@/db";
import { resolveDb } from "@/db";
import { agencyCompensationOwners } from "@/db/schema";
import { ValidationError } from "@/lib/errors";
import { desc } from "drizzle-orm";

export type AgencyOwnerRow = {
  id: number;
  agentId: number | null;
  accountManagerId: number | null;
  effectiveStartMonth: string;
  effectiveEndMonth: string | null;
  createdAt: string;
  updatedAt: string;
  identity: PersonIdentity;
};

function asPeriod(row: AgencyOwnerRow): AgencyCompensationOwnerPeriod {
  return {
    id: row.id,
    identity: row.identity,
    effectiveStartMonth: row.effectiveStartMonth,
    effectiveEndMonth: row.effectiveEndMonth,
  };
}

function asOwnerRow(row: {
  id: number;
  agentId: number | null;
  accountManagerId: number | null;
  effectiveStartMonth: string;
  effectiveEndMonth: string | null;
  createdAt: string;
  updatedAt: string;
}): AgencyOwnerRow {
  const identity = ownerIdentityFromFks(row.agentId, row.accountManagerId);
  if (!identity) {
    throw new ValidationError("Agency owner rows must have exactly one of agent_id or account_manager_id.");
  }
  return { ...row, identity };
}

export async function listAgencyCompensationOwners(db?: AppDatabase): Promise<AgencyOwnerRow[]> {
  const database = await resolveDb(db);
  const rows = await database
    .select()
    .from(agencyCompensationOwners)
    .orderBy(desc(agencyCompensationOwners.effectiveStartMonth), agencyCompensationOwners.id);
  return rows.map(asOwnerRow);
}

export async function getAgencyOwnerForPaidMonth(
  db: AppDatabase | undefined,
  paidMonth: string,
): Promise<PersonIdentity | null> {
  if (!isPaidMonth(paidMonth)) return null;
  const owners = await listAgencyCompensationOwners(db);
  return agencyOwnerForPaidMonth(owners.map(asPeriod), paidMonth);
}

export async function createAgencyCompensationOwner(
  db: AppDatabase | undefined,
  input: {
    agentId?: number | null;
    accountManagerId?: number | null;
    effectiveStartMonth: string;
    effectiveEndMonth?: string | null;
  },
): Promise<AgencyOwnerRow> {
  const identity = ownerIdentityFromFks(input.agentId ?? null, input.accountManagerId ?? null);
  if (!identity) {
    throw new ValidationError("Exactly one of agent_id or account_manager_id must be populated.");
  }
  if (!isPaidMonth(input.effectiveStartMonth)) {
    throw new ValidationError("Effective start month must be YYYY-MM.");
  }
  const effectiveEndMonth = input.effectiveEndMonth ?? null;
  if (effectiveEndMonth != null && !isPaidMonth(effectiveEndMonth)) {
    throw new ValidationError("Effective end month must be YYYY-MM.");
  }
  if (effectiveEndMonth != null && effectiveEndMonth < input.effectiveStartMonth) {
    throw new ValidationError("Effective end month cannot be before the start month.");
  }
  const database = await resolveDb(db);
  const now = new Date().toISOString();
  const [row] = await database.insert(agencyCompensationOwners).values({
    agentId: identity.personKind === "agent" ? identity.personId : null,
    accountManagerId: identity.personKind === "account_manager" ? identity.personId : null,
    effectiveStartMonth: input.effectiveStartMonth,
    effectiveEndMonth,
    createdAt: now,
    updatedAt: now,
  }).returning();
  return asOwnerRow(row);
}
