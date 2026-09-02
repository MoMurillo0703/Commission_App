"use client";

import { useState } from "react";
import type { AgreementView } from "@/data/agreements";
import type { AccountManager, Agent, Group, LineOfBusiness } from "@/db/schema";
import { AccountManagersManager } from "./AccountManagersManager";
import { GroupCompensationManager } from "./GroupCompensationManager";
import { GroupsManager } from "./GroupsManager";

export function GroupsWorkspace({
  groups,
  accountManagers,
  agents,
  linesOfBusiness,
  agreements,
}: {
  groups: Group[];
  accountManagers: AccountManager[];
  agents: Agent[];
  linesOfBusiness: LineOfBusiness[];
  agreements: AgreementView[];
}) {
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(groups[0]?.id ?? null);
  const [groupRows, setGroupRows] = useState(groups);

  return (
    <>
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
      <div className="recent">
        <GroupCompensationManager
          groups={groupRows}
          agents={agents}
          linesOfBusiness={linesOfBusiness}
          initial={agreements}
          selectedGroupId={selectedGroupId}
          onSelectGroup={setSelectedGroupId}
        />
      </div>
    </>
  );
}
