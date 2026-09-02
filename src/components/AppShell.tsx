import Link from "next/link";

const items = [
  { href: "/", id: "overview", label: "Overview" },
  { href: "/statements", id: "statements", label: "Statements" },
  { href: "/groups", id: "groups", label: "Groups" },
  { href: "/products", id: "products", label: "Products" },
  { href: "/agents", id: "agents", label: "Agents" },
] as const;

export type NavId = (typeof items)[number]["id"];

export function AppShell({
  children,
  active,
  reviewCount,
}: {
  children: React.ReactNode;
  active: NavId;
  reviewCount: number;
}) {
  const month = new Date().toLocaleString("en-US", { month: "long" });

  return (
    <main className="shell">
      <aside>
        <div className="brand">
          <span>M</span>
          <div>
            Murillo Insurance
            <small>Commissions</small>
          </div>
        </div>
        <nav>
          {items.map((item) => (
            <Link key={item.id} href={item.href} className={active === item.id ? "active" : undefined}>
              {item.label}
            </Link>
          ))}
          <a>Reports</a>
        </nav>
        <div className="aside-note">
          {month} close
          <br />
          <strong>
            {reviewCount === 0
              ? "No items need review"
              : `${reviewCount} ${reviewCount === 1 ? "item needs" : "items need"} review`}
          </strong>
          {process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? (
            <form action="/auth/signout" method="post" style={{ marginTop: 12 }}>
              <button type="submit" className="secondary">Sign out</button>
            </form>
          ) : null}
        </div>
      </aside>
      <section className="content">{children}</section>
    </main>
  );
}
