import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, brands, categories, customers, loyaltyLedger, products, saleLines, sales, variants } from "@/db";
import { inOrg, requirePage } from "@/lib/auth";
import { agingBuckets, customerStatement } from "@/lib/credit";
import { fmtPoints } from "@/lib/loyalty";
import { can } from "@/lib/permissions";
import { formatPhone } from "@/lib/phone";
import { nairobiDate } from "@/lib/time";
import { Card, Money, PageHeader, Pill } from "@/components/ui";
import { CreditForm, PaymentForm } from "./forms";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { earn: "Earned", bonus: "Bonus", redeem: "Spent", reverse: "Returned items", adjust: "Adjustment" };

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const s = await requirePage("customers.view");
  const id = Number((await params).id);
  const sp = await searchParams;
  const [c] = await db.select().from(customers).where(and(eq(customers.orgId, s.org.id), eq(customers.id, id))).limit(1);
  if (!c) notFound();
  const today = nairobiDate();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : `${today.slice(0, 8)}01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to! : today;
  const earns = c.earnsPointsOverride ?? c.type === "retail";

  const [recent, points, favourites, statement, aging] = await Promise.all([
    db.select().from(sales).where(eq(sales.customerId, c.id)).orderBy(desc(sales.createdAt)).limit(15),
    db.select().from(loyaltyLedger).where(eq(loyaltyLedger.customerId, c.id)).orderBy(desc(loyaltyLedger.createdAt)).limit(20),
    db.execute<{ label: string; units: number }>(sql`
      select coalesce(b.name, cat.name, 'Other') as label, sum(sl.qty)::int as units
      from ${saleLines} sl join ${sales} s on s.id = sl.sale_id
      join ${variants} v on v.id = sl.variant_id join ${products} p on p.id = v.product_id
      left join ${brands} b on b.id = p.brand_id left join ${categories} cat on cat.id = p.category_id
      where s.customer_id = ${c.id} and s.created_at > now() - interval '90 days'
      group by 1 order by 2 desc limit 5`),
    inOrg(s, () => customerStatement(db, c.id, from, to)),
    inOrg(s, () => agingBuckets(db, c.id, today)),
  ]);
  const owed = statement.closingCents;

  return (
    <>
      <PageHeader
        title={c.businessName || c.name || "Customer"}
        subtitle={`${formatPhone(c.phone)} · ${c.type === "wholesale" ? "Salon / wholesale" : "Retail"} · since ${c.createdAt.toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium" })}${c.marketingConsent ? " · agreed to SMS offers" : ""}`}
        actions={<Link href="/customers" className="text-[13px] text-ink-600 underline">All customers</Link>}
      />
      <div className="grid gap-4 sm:grid-cols-3 mb-5">
        <Card className="p-5 grid gap-1"><span className="text-[12.5px] text-ink-400">Loyalty points</span><span className="money-lg">{earns ? fmtPoints(c.pointsBalance) : "Not on points"}</span></Card>
        <Card className="p-5 grid gap-1"><span className="text-[12.5px] text-ink-400">Owes (KES)</span><Money cents={owed} className={`money-lg ${owed > 0 ? "text-bad" : ""}`} /></Card>
        <Card className="p-5 grid gap-1"><span className="text-[12.5px] text-ink-400">Credit</span><span className="money-lg">{c.creditEnabled ? <>KES <Money cents={c.creditLimitCents} /></> : "No credit"}</span>{c.creditEnabled && <span className="text-[12px] text-ink-400">{c.creditTermsDays} days to pay</span>}</Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px] items-start">
        <div className="grid gap-5">
          {(c.creditEnabled || owed !== 0) && (
            <Card className="overflow-x-auto">
              <form className="flex flex-wrap items-end justify-between gap-3 px-4 pt-4 pb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Statement</span>
                <span className="flex gap-2 items-center text-[13px]">
                  <input type="date" name="from" defaultValue={from} className="h-8 rounded-md border-[0.5px] border-ink-200 px-2" />
                  to
                  <input type="date" name="to" defaultValue={to} className="h-8 rounded-md border-[0.5px] border-ink-200 px-2" />
                  <button className="h-8 px-3 rounded-md border-[0.5px] border-ink-200 cursor-pointer">Show</button>
                </span>
              </form>
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-ink-400">
                    <th className="px-4 py-2 font-semibold">Date</th><th className="px-4 py-2 font-semibold">Details</th>
                    <th className="px-4 py-2 font-semibold text-right">Bought</th><th className="px-4 py-2 font-semibold text-right">Paid</th><th className="px-4 py-2 font-semibold text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="hairline-t text-ink-600"><td className="px-4 py-2">{from}</td><td className="px-4 py-2">Opening balance</td><td /><td /><td className="px-4 py-2 text-right"><Money cents={statement.openingCents} /></td></tr>
                  {statement.lines.map((l, i) => (
                    <tr key={i} className="hairline-t">
                      <td className="px-4 py-2 tnum">{l.date}</td><td className="px-4 py-2">{l.description}</td>
                      <td className="px-4 py-2 text-right">{l.chargeCents ? <Money cents={l.chargeCents} /> : ""}</td>
                      <td className="px-4 py-2 text-right">{l.paymentCents ? <Money cents={l.paymentCents} /> : ""}</td>
                      <td className="px-4 py-2 text-right"><Money cents={l.balanceCents} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex flex-wrap gap-4 px-4 py-3 hairline-t text-[12.5px] text-ink-600">
                <span>0–30 days <Money cents={aging.current} /></span>
                <span>31–60 <Money cents={aging.d31_60} className={aging.d31_60 ? "text-warn" : ""} /></span>
                <span>61–90 <Money cents={aging.d61_90} className={aging.d61_90 ? "text-bad" : ""} /></span>
                <span>90+ <Money cents={aging.over90} className={aging.over90 ? "text-bad" : ""} /></span>
              </div>
            </Card>
          )}

          <Card className="overflow-x-auto">
            <div className="px-4 pt-4 pb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Recent purchases</div>
            {recent.length === 0 ? <p className="px-4 pb-4 text-[13.5px] text-ink-400">No purchases yet.</p> : (
              <table className="w-full text-[13.5px]">
                <tbody>
                  {recent.map((r) => (
                    <tr key={r.id} className="hairline-t">
                      <td className="px-4 py-2.5"><a href={`/r/${r.receiptToken}`} target="_blank" className="font-medium hover:underline">{r.receiptNo}</a></td>
                      <td className="px-4 py-2.5 text-ink-600">{r.createdAt.toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" })}</td>
                      <td className="px-4 py-2.5">{r.status !== "completed" && <Pill tone="warn">{r.status === "returned" ? "Returned" : "Part returned"}</Pill>}</td>
                      <td className="px-4 py-2.5 text-right"><Money cents={r.totalCents} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {earns && (
            <Card className="overflow-x-auto">
              <div className="px-4 pt-4 pb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Points history</div>
              {points.length === 0 ? <p className="px-4 pb-4 text-[13.5px] text-ink-400">No points yet.</p> : (
                <table className="w-full text-[13.5px]">
                  <tbody>
                    {points.map((p) => (
                      <tr key={p.id} className="hairline-t">
                        <td className="px-4 py-2.5">{KIND[p.kind] ?? p.kind}{p.note ? <span className="text-ink-400"> · {p.note}</span> : null}</td>
                        <td className="px-4 py-2.5 text-ink-600">{p.createdAt.toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium" })}</td>
                        <td className={`px-4 py-2.5 text-right tnum ${p.points < 0 ? "text-bad" : "text-good"}`}>{p.points > 0 ? "+" : ""}{fmtPoints(p.points)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          )}
        </div>

        <div className="grid gap-4">
          <Card className="p-5 grid gap-2">
            <h2 className="text-[15px] font-semibold">Usually buys</h2>
            {favourites.length === 0 ? <p className="text-[13px] text-ink-400">Nothing in the last 90 days.</p> : favourites.map((f, i) => (
              <div key={i} className="flex justify-between text-[13.5px]"><span>{f.label}</span><span className="tnum text-ink-600">{f.units} items</span></div>
            ))}
          </Card>
          {can(s.role, "books.post") && owed > 0 && <PaymentForm customerId={c.id} owedCents={owed} />}
          {can(s.role, "customers.credit") && <CreditForm customer={{ id: c.id, type: c.type as "retail" | "wholesale", businessName: c.businessName, creditEnabled: c.creditEnabled, creditLimitCents: c.creditLimitCents, creditTermsDays: c.creditTermsDays }} />}
        </div>
      </div>
    </>
  );
}
