import { AppShell } from "@/components/AppShell";
import { NameEntityManager } from "@/components/NameEntityManager";
import { listCarriers } from "@/data/carriers";
import { countUnassignedCommissions } from "@/data/commissions";
import { listLinesOfBusiness } from "@/data/linesOfBusiness";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  return (
    <AppShell active="products" reviewCount={await countUnassignedCommissions()}>
      <header>
        <div>
          <p className="eyebrow">Reference data</p>
          <h1>Products</h1>
          <p>Carriers and lines of business used on commission records.</p>
        </div>
      </header>
      <div className="grid">
        <NameEntityManager
          eyebrow="Carriers"
          title="Carriers"
          addLabel="Add carrier"
          empty="No carriers on file yet."
          initial={await listCarriers()}
          endpoint="/api/carriers"
        />
        <NameEntityManager
          eyebrow="Lines of business"
          title="Lines of business"
          addLabel="Add line of business"
          empty="No lines of business on file yet."
          initial={await listLinesOfBusiness()}
          endpoint="/api/lines-of-business"
        />
      </div>
    </AppShell>
  );
}
