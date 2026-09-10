import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { PersonDetailWorkspace } from "@/components/PersonDetailWorkspace";
import { countUnassignedCommissions } from "@/data/commissions";
import { loadPersonWorkspace } from "@/data/peopleWorkspace";
import { getDb } from "@/db";
import { NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export default async function AccountManagerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1) notFound();
  const db = await getDb();
  let detail;
  try {
    detail = await loadPersonWorkspace(db, "account_manager", id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  return (
    <AppShell active="people" reviewCount={await countUnassignedCommissions(db)}>
      <PersonDetailWorkspace detail={detail} />
    </AppShell>
  );
}
