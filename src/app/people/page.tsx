import { AppShell } from "@/components/AppShell";
import { PeopleDirectory } from "@/components/PeopleDirectory";
import { countUnassignedCommissions } from "@/data/commissions";
import { loadPeopleDirectory } from "@/data/peopleWorkspace";
import { getDb } from "@/db";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  const db = await getDb();
  const directory = await loadPeopleDirectory(db);
  return (
    <AppShell active="people" reviewCount={await countUnassignedCommissions(db)}>
      <header>
        <div>
          <p className="eyebrow">Account management</p>
          <h1>People</h1>
          <p>Open a person to see assigned Groups, actual compensation relationships, and a Reports link. Names are not merged.</p>
        </div>
      </header>
      <PeopleDirectory people={directory.people} />
    </AppShell>
  );
}
