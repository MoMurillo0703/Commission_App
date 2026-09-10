export type PersonRole = "agent" | "account_manager";

export type PersonDirectoryEntry = {
  key: string;
  name: string;
  roles: PersonRole[];
  agentId: number | null;
  accountManagerId: number | null;
  groupNames: string[];
  primaryAgentGroupCount: number;
  accountManagerGroupCount: number;
  activeTeamCount: number;
  href: string;
};

export function buildPeopleDirectory(input: {
  agents: Array<{ id: number; name: string }>;
  accountManagers: Array<{ id: number; name: string }>;
  groups: Array<{ id?: number; name: string; primaryAgentId: number | null; accountManagerId: number | null }>;
  agreementGroupNamesByAgentId?: Record<number, string[]>;
  activeTeamCountByPerson?: Record<string, number>;
}): PersonDirectoryEntry[] {
  const people: PersonDirectoryEntry[] = [];

  for (const agent of input.agents) {
    const assigned = input.groups.filter((row) => row.primaryAgentId === agent.id);
    const person: PersonDirectoryEntry = {
      key: `agent:${agent.id}`,
      name: agent.name.trim(),
      roles: ["agent"],
      agentId: agent.id,
      accountManagerId: null,
      groupNames: assigned.map((row) => row.name),
      primaryAgentGroupCount: assigned.length,
      accountManagerGroupCount: 0,
      activeTeamCount: input.activeTeamCountByPerson?.[`agent:${agent.id}`] ?? 0,
      href: `/people/agent/${agent.id}`,
    };
    for (const groupName of input.agreementGroupNamesByAgentId?.[agent.id] ?? []) {
      if (!person.groupNames.includes(groupName)) person.groupNames.push(groupName);
    }
    people.push(person);
  }

  for (const manager of input.accountManagers) {
    const assigned = input.groups.filter((row) => row.accountManagerId === manager.id);
    people.push({
      key: `account_manager:${manager.id}`,
      name: manager.name.trim(),
      roles: ["account_manager"],
      agentId: null,
      accountManagerId: manager.id,
      groupNames: assigned.map((row) => row.name),
      primaryAgentGroupCount: 0,
      accountManagerGroupCount: assigned.length,
      activeTeamCount: input.activeTeamCountByPerson?.[`account_manager:${manager.id}`] ?? 0,
      href: `/people/account-manager/${manager.id}`,
    });
  }

  return people.sort((left, right) => left.name.localeCompare(right.name) || left.key.localeCompare(right.key));
}

export function personRoleLabel(roles: PersonRole[]) {
  const labels = roles.map((role) => (role === "agent" ? "Agent" : "Account manager"));
  return labels.join(" · ") || "No role";
}

export function filterPeopleDirectory(
  people: PersonDirectoryEntry[],
  query: string,
  role: "all" | PersonRole,
) {
  const needle = query.trim().toLowerCase();
  return people.filter((person) => {
    if (role !== "all" && !person.roles.includes(role)) return false;
    return !needle || person.name.toLowerCase().includes(needle) || person.groupNames.some((name) => name.toLowerCase().includes(needle));
  });
}
