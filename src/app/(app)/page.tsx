import Link from "next/link";
import { redirect } from "next/navigation";
import { and, count, eq, sql } from "drizzle-orm";
import { db, priceChangeRequests, products, stockLots, variants } from "@/db";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { Card, Money } from "@/components/ui";

export default async function TodayPage() {
  const s = await requirePage(null);
  if (s.role === "cashier") redirect("/till");
  const orgId = s.org.id;
  const [[productCount], [stock], lowStock, [pending]] = await Promise.all([
    db.select({ n: count() }).from(products).where(and(eq(products.orgId, orgId), eq(products.archived, false))),
    db.select({ value: sql<string>`coalesce(sum(${stockLots.remainingCostCents}),0)`, units: sql<string>`coalesce(sum(${stockLots.remainingQty}),0)` }).from(stockLots).where(eq(stockLots.orgId, orgId)),
    db.execute<{ name: string; option: string | null; qty: number; reorder: number }>(sql`
      select p.name, concat_ws(' · ', v.option1_value, v.option2_value) as option,
             coalesce(sum(l.remaining_qty),0)::int as qty, v.reorder_level as reorder
      from ${variants} v join ${products} p on p.id = v.product_id
      left join ${stockLots} l on l.variant_id = v.id
      where v.org_id = ${orgId} and not v.archived and not p.archived and v.reorder_level > 0
      group by v.id, p.name
      having coalesce(sum(l.remaining_qty),0) <= v.reorder_level
      order by qty asc limit 8`),
    db.select({ n: count() }).from(priceChangeRequests).where(and(eq(priceChangeRequests.orgId, orgId), eq(priceChangeRequests.status, "pending"))),
  ]);

  const showCosts = can(s.role, "catalog.view_costs");
  const hour = Number(new Intl.DateTimeFormat("en-KE", { hour: "numeric", hour12: false, timeZone: "Africa/Nairobi" }).format(new Date()));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight">{greeting}, {s.member.name.split(" ")[0] || "there"}</h1>
        <p className="text-[13.5px] text-ink-400 mt-1">Sales, cash and shifts appear here once the till is running.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5 grid gap-1">
          <span className="text-[12.5px] text-ink-400">Products</span>
          <span className="money-lg">{productCount.n}</span>
        </Card>
        <Card className="p-5 grid gap-1">
          <span className="text-[12.5px] text-ink-400">Units on the shelf</span>
          <span className="money-lg">{Number(stock.units).toLocaleString("en-KE")}</span>
        </Card>
        {showCosts && (
          <Card className="p-5 grid gap-1">
            <span className="text-[12.5px] text-ink-400">Stock value at cost (KES)</span>
            <Money cents={Number(stock.value)} className="money-lg" />
          </Card>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-5 grid gap-3 content-start">
          <h2 className="text-[15px] font-semibold">Running low</h2>
          {lowStock.length === 0 ? (
            <p className="text-[13.5px] text-ink-400">Nothing is below its reorder level.</p>
          ) : (
            <ul className="grid gap-2 text-[13.5px]">
              {lowStock.map((r, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>{r.name}{r.option ? <span className="text-ink-400"> · {r.option}</span> : null}</span>
                  <span className={`tnum ${r.qty <= 0 ? "text-bad" : "text-warn"}`}>{r.qty} left</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {can(s.role, "catalog.set_prices") && (
          <Card className="p-5 grid gap-2 content-start">
            <h2 className="text-[15px] font-semibold">Waiting for you</h2>
            <p className="text-[13.5px] text-ink-600">
              {pending.n === 0 ? "No price suggestions to review." : <>{pending.n} price suggestion{pending.n === 1 ? "" : "s"} from staff. <Link className="text-brand-700 underline" href="/products">Review</Link></>}
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
