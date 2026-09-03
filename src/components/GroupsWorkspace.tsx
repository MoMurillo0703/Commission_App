"use client";

import { useState } from "react";
import type { AccountManager, Agent, Group } from "@/db/schema";
import { AccountManagersManager } from "./AccountManagersManager";
import { GroupsManager } from "./GroupsManager";

export function GroupsWorkspace({
  groups,
  accountManagers,
  agents,
}: {
  groups: Group[];
  accountManagers: AccountManager[];
  agents: Agent[];
  linesOfBusiness?: unknown;
  agreements?: unknown;
}) {
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(groups[0]?.id ?? null);
  const [groupRows, setGroupRows] = useState(groups);

  return (
    <div className="grid">
      <AccountManagersManager initial={accountManagers} groups={groupRows} />
      <GroupsManager
        initial={groups}
        accountManagers={accountManagers}
        agents={agents}
        selectedId={selectedGroupId}
        onSelect={setSelectedGroupId}
        onGroupsChange={setGroupRows}
      />
    </div>
  );
}
