import { requirePage } from "@/lib/auth";
import { can, ROLE_LABELS, type Permission } from "@/lib/permissions";
import { Sidebar, type NavGroup } from "@/components/sidebar";

const NAV: { label: string; items: { href: string; label: string; perm: Permission | null }[] }[] = [
  {
    label: "Home",
    items: [
      { href: "/", label: "Today", perm: null },
      { href: "/till", label: "Open the till", perm: "till.sell" },
      { href: "/sales/shifts", label: "Shifts & cash-ups", perm: "reports.view" },
    ],
  },
  {
    label: "Customers",
    items: [
      { href: "/customers", label: "Customers", perm: "customers.view" },
      { href: "/offers", label: "Offers", perm: "catalog.view" },
    ],
  },
  {
    label: "Products",
    items: [
      { href: "/products", label: "Catalogue", perm: "catalog.view" },
      { href: "/products/brands", label: "Brands", perm: "catalog.edit" },
      { href: "/products/categories", label: "Categories", perm: "catalog.edit" },
    ],
  },
  {
    label: "Stock",
    items: [
      { href: "/stock/receive", label: "Receive stock", perm: "stock.receive" },
      { href: "/stock/bills", label: "Supplier invoices", perm: "stock.receive" },
      { href: "/stock/counts", label: "Stock take", perm: "stock.count" },
      { href: "/stock/adjust", label: "Adjust stock", perm: "stock.receive" },
      { href: "/suppliers", label: "Suppliers", perm: "suppliers.edit" },
    ],
  },
  { label: "Money", items: [{ href: "/books/accounts", label: "Chart of accounts", perm: "books.view" }] },
  {
    label: "Settings",
    items: [
      { href: "/settings/pin", label: "My PIN", perm: null },
      { href: "/settings/messages", label: "SMS messages", perm: "settings.edit" },
    ],
  },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requirePage(null);
  const groups: NavGroup[] = NAV.map((g) => ({ label: g.label, items: g.items.filter((i) => !i.perm || can(s.role, i.perm)) })).filter((g) => g.items.length);
  return (
    <div className="md:flex min-h-screen">
      <Sidebar groups={groups} shopName={s.org.name} userName={s.member.name || s.email} roleLabel={ROLE_LABELS[s.role]} />
      <main className="flex-1 min-w-0">
        <div className="mx-auto max-w-6xl w-full px-4 py-6 md:px-8 md:py-8">{children}</div>
      </main>
    </div>
  );
}
