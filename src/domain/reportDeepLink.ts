import { currentPaidMonth } from "./dates";
import { personKey, type PersonIdentity } from "./agencyOwner";

export function reportsHref(input: {
  kind?: "individual" | "agency" | "team";
  person?: PersonIdentity | null;
  agencyOwner?: boolean;
  paidMonth?: string | null;
  groupId?: number | null;
}) {
  const params = new URLSearchParams();
  params.set("kind", input.kind ?? (input.agencyOwner ? "individual" : "individual"));
  if (input.agencyOwner) params.set("personKey", "agency_owner");
  else if (input.person) params.set("personKey", personKey(input.person));
  const month = input.paidMonth ?? currentPaidMonth();
  if (month) params.set("paidMonth", month);
  if (input.groupId) params.set("groupId", String(input.groupId));
  return `/reports?${params.toString()}`;
}

export function parseReportsSearchParams(params: {
  kind?: string;
  personKey?: string;
  personKind?: string;
  personId?: string;
  paidMonth?: string;
  groupId?: string;
}): {
  kind: "individual" | "agency" | "team";
  personKey: string;
  paidMonth: string;
  groupId: string;
} {
  const kind: "individual" | "agency" | "team" =
    params.kind === "agency" || params.kind === "team" || params.kind === "individual"
      ? params.kind
      : "individual";
  const personKey = params.personKey
    ?? (params.personKind === "agency_owner"
      ? "agency_owner"
      : params.personKind && params.personId
        ? `${params.personKind}:${params.personId}`
        : "");
  return {
    kind,
    personKey,
    paidMonth: params.paidMonth ?? "",
    groupId: params.groupId ?? "",
  };
}
