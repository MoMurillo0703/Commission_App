import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { GroupDetailWorkspace } from "@/components/GroupDetailWorkspace";
import { countUnassignedCommissions } from "@/data/commissions";
import { loadGroupWorkspace } from "@/data/groupWorkspace";
import { getDb } from "@/db";
import { NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export default async function GroupDetailPage({ params }: { params: Promise<{ groupId: string }> }) {
  const groupId = Number((await params).groupId);
  if (!Number.isInteger(groupId) || groupId < 1) notFound();
  const db = await getDb();
  let workspace;
  try {
    workspace = await loadGroupWorkspace(db, groupId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const reviewCount = await countUnassignedCommissions(db);
  return (
    <AppShell active="groups" reviewCount={reviewCount}>
      <header>
        <div>
          <p className="eyebrow">Group workspace</p>
          <h1>{workspace.group.name}</h1>
          <p>One place for identity, assignment, compensation, and received commissions.</p>
        </div>
      </header>
      <GroupDetailWorkspace
        asOfMonth={workspace.asOfMonth}
        group={workspace.group}
        identities={workspace.identities}
        carrierNames={workspace.directoryRow.carrierNames}
        lineOfBusinessNames={workspace.directoryRow.lineOfBusinessNames}
        compensationLines={workspace.compensationLines}
        commissions={workspace.commissions}
        lookups={workspace.lookups}
        allocations={workspace.allocations}
      />
    </AppShell>
  );
}
