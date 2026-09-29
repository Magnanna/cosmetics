import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { PageHeader } from "@/components/ui";

const GROUPS = [
  {
    label: "How the shop is doing",
    items: [
      { href: "/reports/pnl", title: "Profit & loss", body: "Sales, cost of what was sold, running costs and profit for any period." },
      { href: "/reports/sales", title: "Sales analysis", body: "By day, hour, category, brand, product, cashier or customer type — with margins." },
      { href: "/reports/stock", title: "Stock value", body: "What's on the shelves at cost and retail, and what hasn't sold in 60 days." },
    ],
  },
  {
    label: "For the accountant",
    items: [
      { href: "/reports/balance-sheet", title: "Balance sheet", body: "What the shop owns, owes, and the owner's stake on a date." },
      { href: "/reports/trial-balance", title: "Trial balance", body: "Every account's balance — debits must equal credits." },
      { href: "/books/accounts", title: "Chart of accounts", body: "Click any account for its full ledger." },
    ],
  },
  {
    label: "Tax",
    items: [{ href: "/reports/tot", title: "Turnover Tax", body: "Monthly turnover, the 1.5% due by the 20th, and what's been paid." }],
  },
];

export default async function ReportsPage() {
  await requirePage("reports.view");
  return (
    <>
      <PageHeader title="Reports" subtitle="Every number comes straight from the books, so all reports agree." />
      <div className="grid gap-6">
        {GROUPS.map((g) => (
          <div key={g.label} className="grid gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">{g.label}</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((i) => (
                <Link key={i.href} href={i.href} className="card p-4 grid gap-1 hover:border-brand">
                  <span className="font-semibold text-[14.5px]">{i.title}</span>
                  <span className="text-[13px] text-ink-600">{i.body}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
