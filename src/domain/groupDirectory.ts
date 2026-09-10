export type GroupDirectoryLetter = "all" | "#" | "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L" | "M" | "N" | "O" | "P" | "Q" | "R" | "S" | "T" | "U" | "V" | "W" | "X" | "Y" | "Z";

export const GROUP_ALPHABET: GroupDirectoryLetter[] = [
  "all", "#",
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
  "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
];

export type GroupDirectoryCompensationFilter = "all" | "configured" | "default" | "review_required";

export type GroupDirectoryFilters = {
  query: string;
  letter: GroupDirectoryLetter;
  carrierId: number | null;
  lineOfBusinessId: number | null;
  primaryAgentId: number | null;
  accountManagerId: number | null;
  compensationStatus: GroupDirectoryCompensationFilter;
  unassignedPrimaryAgent: boolean;
  unassignedAccountManager: boolean;
};

export type GroupDirectoryRow = {
  id: number;
  name: string;
  groupNumber: string | null;
  externalGroupNumbers: string[];
  primaryAgentId: number | null;
  primaryAgentName: string | null;
  accountManagerId: number | null;
  accountManagerName: string | null;
  carrierIds: number[];
  carrierNames: string[];
  lineOfBusinessIds: number[];
  lineOfBusinessNames: string[];
  compensationKind: "explicit_configured" | "explicit_agency" | "default_unconfigured" | "future" | "historical" | "review_required" | "none";
  compensationLabel: string;
};

export function emptyGroupDirectoryFilters(): GroupDirectoryFilters {
  return {
    query: "",
    letter: "all",
    carrierId: null,
    lineOfBusinessId: null,
    primaryAgentId: null,
    accountManagerId: null,
    compensationStatus: "all",
    unassignedPrimaryAgent: false,
    unassignedAccountManager: false,
  };
}

export function groupAlphabetKey(name: string): Exclude<GroupDirectoryLetter, "all"> {
  const ch = name.trim().charAt(0).toUpperCase();
  if (ch >= "A" && ch <= "Z") return ch as Exclude<GroupDirectoryLetter, "all" | "#">;
  return "#";
}

export function groupMatchesSearch(
  group: Pick<GroupDirectoryRow, "name" | "groupNumber" | "externalGroupNumbers">,
  query: string,
) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (group.name.toLowerCase().includes(needle)) return true;
  if ((group.groupNumber ?? "").toLowerCase().includes(needle)) return true;
  return group.externalGroupNumbers.some((value) => value.toLowerCase().includes(needle));
}

function compensationMatchesFilter(
  kind: GroupDirectoryRow["compensationKind"],
  filter: GroupDirectoryCompensationFilter,
) {
  if (filter === "all") return true;
  if (filter === "configured") return kind === "explicit_configured" || kind === "explicit_agency";
  if (filter === "default") return kind === "default_unconfigured" || kind === "historical" || kind === "future" || kind === "none";
  return kind === "review_required";
}

export function filterGroupDirectory(rows: GroupDirectoryRow[], filters: GroupDirectoryFilters) {
  return rows.filter((row) => {
    if (!groupMatchesSearch(row, filters.query)) return false;
    if (filters.letter !== "all" && groupAlphabetKey(row.name) !== filters.letter) return false;
    if (filters.carrierId != null && !row.carrierIds.includes(filters.carrierId)) return false;
    if (filters.lineOfBusinessId != null && !row.lineOfBusinessIds.includes(filters.lineOfBusinessId)) return false;
    if (filters.primaryAgentId != null && row.primaryAgentId !== filters.primaryAgentId) return false;
    if (filters.accountManagerId != null && row.accountManagerId !== filters.accountManagerId) return false;
    if (filters.unassignedPrimaryAgent && row.primaryAgentId != null) return false;
    if (filters.unassignedAccountManager && row.accountManagerId != null) return false;
    if (!compensationMatchesFilter(row.compensationKind, filters.compensationStatus)) return false;
    return true;
  });
}

export function groupDirectoryCountLabel(count: number, total: number) {
  if (count === total) return `${count} group${count === 1 ? "" : "s"}`;
  return `${count} of ${total} groups`;
}
