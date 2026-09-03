export type PersonRole = "agent" | "account_manager";

export type PersonDirectoryEntry = {
  key: string;
  name: string;
  roles: PersonRole[];
  agentId: number | null;
  accountManagerId: number | null;
  groupNames: string[];
};

export function buildPeopleDirectory(input: {
  agents: Array<{ id: number; name: string }>;
  accountManagers: Array<{ id: number; name: string }>;
  groups: Array<{ name: string; primaryAgentId: number | null; accountManagerId: number | null }>;
  agreementGroupNamesByAgentId?: Record<number, string[]>;
}): PersonDirectoryEntry[] {
  const people: PersonDirectoryEntry[] = [];

  for (const agent of input.agents) {
    const person: PersonDirectoryEntry = { key: `agent:${agent.id}`, name: agent.name.trim(), roles: ["agent"], agentId: agent.id, accountManagerId: null, groupNames: [] };
    for (const group of input.groups.filter((row) => row.primaryAgentId === agent.id)) {
      if (!person.groupNames.includes(group.name)) person.groupNames.push(group.name);
    }
    for (const groupName of input.agreementGroupNamesByAgentId?.[agent.id] ?? []) {
      if (!person.groupNames.includes(groupName)) person.groupNames.push(groupName);
    }
    people.push(person);
  }

  for (const manager of input.accountManagers) {
    const person: PersonDirectoryEntry = { key: `account-manager:${manager.id}`, name: manager.name.trim(), roles: ["account_manager"], agentId: null, accountManagerId: manager.id, groupNames: [] };
    for (const group of input.groups.filter((row) => row.accountManagerId === manager.id)) {
      if (!person.groupNames.includes(group.name)) person.groupNames.push(group.name);
    }
    people.push(person);
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
