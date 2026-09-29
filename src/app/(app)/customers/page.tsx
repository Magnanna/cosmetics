import Link from "next/link";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, customers } from "@/db";
import { requirePage } from "@/lib/auth";
import { SYS } from "@/lib/coa";
import { fmtPoints } from "@/lib/loyalty";
import { formatPhone, normalizeKenyanPhone } from "@/lib/phone";
import { EmptyState, Money, PageHeader, Pill } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string }> }) {
  const s = await requirePage("customers.view");
  const { q = "", type = "" } = await searchParams;
  const conds = [eq(customers.orgId, s.org.id)];
  if (type === "retail" || type === "wholesale") conds.push(eq(customers.type, type));
  if (type === "credit") conds.push(eq(customers.creditEnabled, true));
  if (q.trim()) {
    const phone = normalizeKenyanPhone(q);
    conds.push(or(ilike(customers.name, `%${q.trim()}%`), ilike(customers.businessName, `%${q.trim()}%`), phone ? eq(customers.phone, phone) : ilike(customers.phone, `%${q.replace(/\D/g, "")}%`))!);
  }
  const rows = await db
    .select({
      c: customers,
      visits: sql<number>`(select count(*)::int from sales s where s.customer_id = "customers"."id")`,
      spend: sql<string>`(select coalesce(sum(s.total_cents),0) from sales s where s.customer_id = "customers"."id")`,
      last: sql<string | null>`(select max(s.created_at)::text from sales s where s.customer_id = "customers"."id")`,
      owed: sql<string>`(select coalesce(sum(jl.debit_cents - jl.credit_cents),0) from journal_lines jl join accounts a on a.id = jl.account_id where jl.customer_id = "customers"."id" and a.code = ${SYS.AR})`,
    })
    .from(customers)
    .where(and(...conds))
    .orderBy(desc(sql`coalesce((select max(s.created_at) from sales s where s.customer_id = "customers"."id"), "customers"."created_at")`))
    .limit(200);

  const filters = [
    { key: "", label: "All" },
    { key: "retail", label: "Retail" },
    { key: "wholesale", label: "Salons / wholesale" },
    { key: "credit", label: "On credit" },
  ];

  return (
    <>
      <PageHeader title="Customers" subtitle="Everyone who has bought, by phone number." />
      <form className="flex flex-wrap gap-2 mb-4">
        <input name="q" defaultValue={q} placeholder="Name or phone" className="h-9 w-64 rounded-md bg-white px-3 text-[14px] border-[0.5px] border-ink-200" />
        {type && <input type="hidden" name="type" value={type} />}
        <div className="flex gap-1.5">
          {filters.map((f) => (
            <Link key={f.key} href={`/customers?${new URLSearchParams({ ...(q ? { q } : {}), ...(f.key ? { type: f.key } : {}) })}`} className={`h-9 px-3 rounded-full text-[13px] grid place-items-center border-[0.5px] ${type === f.key ? "bg-brand-tint text-brand-700 border-transparent font-semibold" : "bg-white border-ink-200 text-ink-600"}`}>
              {f.label}
            </Link>
          ))}
        </div>
      </form>
      {rows.length === 0 ? (
        <EmptyState title="No customers found" body="Customers are added at the till when their phone number is taken." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-ink-400">
                <th className="px-4 py-3 font-semibold">Customer</th>
                <th className="px-4 py-3 font-semibold text-right">Visits</th>
                <th className="px-4 py-3 font-semibold text-right">Spent</th>
                <th className="px-4 py-3 font-semibold text-right">Points</th>
                <th className="px-4 py-3 font-semibold text-right">Owes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, visits, spend, last, owed }) => (
                <tr key={c.id} className="hairline-t">
                  <td className="px-4 py-3">
                    <Link href={`/customers/${c.id}`} className="font-medium hover:underline">{c.businessName || c.name || "Unnamed"}</Link>
                    {c.type === "wholesale" && <span className="ml-2"><Pill tone="brand">Wholesale</Pill></span>}
                    <div className="text-[12px] text-ink-400 tnum">{formatPhone(c.phone)}{last ? ` · last ${new Date(last).toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium" })}` : ""}</div>
                  </td>
                  <td className="px-4 py-3 text-right tnum">{visits}</td>
                  <td className="px-4 py-3 text-right"><Money cents={Number(spend)} /></td>
                  <td className="px-4 py-3 text-right tnum">{(c.earnsPointsOverride ?? c.type === "retail") ? fmtPoints(c.pointsBalance) : "—"}</td>
                  <td className={`px-4 py-3 text-right ${Number(owed) > 0 ? "text-bad" : ""}`}>{Number(owed) ? <Money cents={Number(owed)} /> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
