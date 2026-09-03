import { AppShell } from "@/components/AppShell";
import { NameEntityManager } from "@/components/NameEntityManager";
import { listCarriers } from "@/data/carriers";
import { countUnassignedCommissions } from "@/data/commissions";

export const dynamic = "force-dynamic";

export default async function CarriersPage() {
  return (
    <AppShell active="carriers" reviewCount={await countUnassignedCommissions()}>
      <header><div><p className="eyebrow">Reference data</p><h1>Carriers</h1><p>Insurance carriers used to identify and report commission statements.</p></div></header>
      <NameEntityManager eyebrow="Carriers" title="Carrier directory" addLabel="Add carrier" empty="No carriers on file yet." initial={await listCarriers()} endpoint="/api/carriers" />
    </AppShell>
  );
}
