import Link from "next/link";
import { redirect } from "next/navigation";
import { and, count, eq, sql } from "drizzle-orm";
import { db, accounts, journalLines, priceChangeRequests, products, salePayments, sales, shifts, stockLots, variants } from "@/db";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { SYS } from "@/lib/coa";
import { nairobiDate } from "@/lib/time";
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

  const today = nairobiDate();
  const [[todays], tenders, [drawer], shortShifts] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(${sales.totalCents}),0)`, cost: sql<string>`coalesce(sum(${sales.costCents}),0)` }).from(sales).where(and(eq(sales.orgId, orgId), eq(sales.businessDate, today))),
    db.select({ method: salePayments.method, total: sql<string>`sum(${salePayments.amountCents})` }).from(salePayments).innerJoin(sales, eq(sales.id, salePayments.saleId)).where(and(eq(sales.orgId, orgId), eq(sales.businessDate, today))).groupBy(salePayments.method),
    db.select({ b: sql<string>`coalesce(sum(${journalLines.debitCents} - ${journalLines.creditCents}),0)` }).from(journalLines).innerJoin(accounts, eq(accounts.id, journalLines.accountId)).where(and(eq(journalLines.orgId, orgId), eq(accounts.code, SYS.CASH_DRAWER))),
    db.select({ id: shifts.id, v: shifts.varianceCents, at: shifts.closedAt }).from(shifts).where(and(eq(shifts.orgId, orgId), eq(shifts.status, "closed"), sql`${shifts.varianceCents} <> 0`, sql`${shifts.closedAt} > now() - interval '7 days'`)).limit(5),
  ]);
  const salesToday = Number(todays.total);
  const marginPct = salesToday > 0 ? Math.round(((salesToday - Number(todays.cost)) / salesToday) * 100) : null;
  const tender = (m: string) => Number(tenders.find((t) => t.method === m)?.total ?? 0);
  const showCosts = can(s.role, "catalog.view_costs");
  const hour = Number(new Intl.DateTimeFormat("en-KE", { hour: "numeric", hour12: false, timeZone: "Africa/Nairobi" }).format(new Date()));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight">{greeting}, {s.member.name.split(" ")[0] || "there"}</h1>
        <p className="text-[13.5px] text-ink-400 mt-1">{new Date().toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "full" })}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-5 grid gap-1">
          <span className="text-[12.5px] text-ink-400">Sales today (KES)</span>
          <Money cents={salesToday} className="money-lg" />
          <span className="text-[12px] text-ink-400">{todays.n} receipt{todays.n === 1 ? "" : "s"}{todays.n ? ` · avg ${(salesToday / todays.n / 100).toLocaleString("en-KE", { maximumFractionDigits: 0 })}` : ""}</span>
        </Card>
        {showCosts && (
          <Card className="p-5 grid gap-1">
            <span className="text-[12.5px] text-ink-400">Gross margin today</span>
            <span className="money-lg">{marginPct === null ? "—" : `${marginPct}%`}</span>
            <span className="text-[12px] text-ink-400">after the cost of what was sold</span>
          </Card>
        )}
        <Card className="p-5 grid gap-1">
          <span className="text-[12.5px] text-ink-400">Cash in the drawer (KES)</span>
          <Money cents={Number(drawer.b)} className="money-lg" />
          <span className="text-[12px] text-ink-400">M-Pesa today {(tender("mpesa") / 100).toLocaleString("en-KE", { minimumFractionDigits: 2 })}</span>
        </Card>
        <Card className="p-5 grid gap-1">
          <span className="text-[12.5px] text-ink-400">Sold on account today (KES)</span>
          <Money cents={tender("credit")} className="money-lg" />
          <Link href="/customers?type=credit" className="text-[12px] text-brand-700 underline">Credit customers</Link>
        </Card>
      </div>
      {shortShifts.length > 0 && can(s.role, "reports.view") && (
        <Card className="p-4 flex flex-wrap gap-x-4 gap-y-1 items-center text-[13.5px]">
          <span className="font-semibold">Tills that didn't balance this week:</span>
          {shortShifts.map((x) => (
            <Link key={x.id} href={`/sales/shifts/${x.id}`} className={`underline tnum ${x.v! < 0 ? "text-bad" : "text-warn"}`}>
              {x.at?.toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium" })} {x.v! < 0 ? "short" : "over"} {(Math.abs(x.v!) / 100).toLocaleString("en-KE")}
            </Link>
          ))}
        </Card>
      )}
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
              {pending.n === 0 ? "No price suggestions to review." : <>{pending.n} price suggestion{pending.n === 1 ? "" : "s"} from staff. <Link className="text-brand-700 underline" href="/products/prices">Review</Link></>}
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
