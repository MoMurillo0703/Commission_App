import { AppShell } from "@/components/AppShell";
import { NameEntityManager } from "@/components/NameEntityManager";
import { countUnassignedCommissions } from "@/data/commissions";
import { listLinesOfBusiness } from "@/data/linesOfBusiness";

export const dynamic = "force-dynamic";

export default async function LinesPage() {
  return (
    <AppShell active="carriers" reviewCount={await countUnassignedCommissions()}>
      <header><div><p className="eyebrow">Reference data</p><h1>Lines of business</h1><p>Product categories used for commission mapping and compensation agreements.</p></div></header>
      <NameEntityManager eyebrow="Lines of business" title="Product lines" addLabel="Add line of business" empty="No lines of business on file yet." initial={await listLinesOfBusiness()} endpoint="/api/lines-of-business" />
    </AppShell>
  );
}
