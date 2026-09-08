import type { PersonIdentity } from "@/domain/agencyOwner";
import { parsePersonKey } from "@/domain/agencyOwner";

export function resolveAgencyOwnerIdentity(
  env: Record<string, string | undefined> = process.env,
): PersonIdentity | null {
  const kind = env.AGENCY_OWNER_PERSON_KIND?.trim();
  const rawId = env.AGENCY_OWNER_PERSON_ID?.trim();
  if (!kind && !rawId) return null;
  return parsePersonKey(`${kind}:${rawId}`);
}
