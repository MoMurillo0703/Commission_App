import { AppShell } from "@/components/AppShell";
import { GroupsDirectory } from "@/components/GroupsDirectory";
import { countUnassignedCommissions } from "@/data/commissions";
import { loadGroupDirectory } from "@/data/groupWorkspace";
import { getDb } from "@/db";

export const dynamic = "force-dynamic";

export default async function GroupsPage() {
  const db = await getDb();
  const directory = await loadGroupDirectory(db);
  const reviewCount = await countUnassignedCommissions(db);
  return (
    <AppShell active="groups" reviewCount={reviewCount}>
      <header>
        <div>
          <p className="eyebrow">Account management</p>
          <h1>Groups</h1>
          <p>Find a Group, then open it to manage who is assigned, how compensation is configured, and what commissions were received.</p>
        </div>
      </header>
      <GroupsDirectory
        rows={directory.rows}
        agents={directory.lookups.agents}
        accountManagers={directory.lookups.accountManagers}
        carriers={directory.lookups.carriers}
        linesOfBusiness={directory.lookups.linesOfBusiness}
      />
    </AppShell>
  );
}
