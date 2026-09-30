import Link from "next/link";
import { redirect } from "next/navigation";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { db, accounts, customers, journalLines, members, priceChangeRequests, products, salePayments, sales, shifts, stockLots, variants } from "@/db";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { SYS } from "@/lib/coa";
import { fmtKES } from "@/lib/money";
import { nairobiDate } from "@/lib/time";
import { Money, Panel, Stat } from "@/components/ui";
import { SalesTrendChart, TenderDonut } from "@/components/dashboard-charts";

const DAYS = 14;
/** Headline tiles show whole shillings so big figures fit; tables keep the cents. */
const kes = (cents: number) => `KES ${Math.round(cents / 100).toLocaleString("en-KE")}`;
const TENDER_LABELS: Record<string, string> = { cash: "Cash", mpesa: "M-Pesa", credit: "On account", points: "Points", exchange: "Exchange credit" };

/** YYYY-MM-DD `n` days before `iso` (calendar arithmetic, no time zone drift). */
function daysBefore(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function glBalance(orgId: number, code: string) {
  return db
    .select({ b: sql<string>`coalesce(sum(${journalLines.debitCents} - ${journalLines.creditCents}),0)` })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalLines.orgId, orgId), eq(accounts.code, code)));
}

export default async function TodayPage() {
  const s = await requirePage(null);
  if (s.role === "cashier") redirect("/till");
  const orgId = s.org.id;
  const today = nairobiDate();
  const since = daysBefore(today, DAYS - 1);
  const monthStart = `${today.slice(0, 8)}01`;

  const [[productCount], [stock], lowStock, [pending], [todays], tenders, [drawer], [owed], shortShifts, daily, monthTenders, recent] = await Promise.all([
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
    db.select({ n: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(${sales.totalCents}),0)`, cost: sql<string>`coalesce(sum(${sales.costCents}),0)` }).from(sales).where(and(eq(sales.orgId, orgId), eq(sales.businessDate, today))),
    db.select({ method: salePayments.method, total: sql<string>`sum(${salePayments.amountCents})` }).from(salePayments).innerJoin(sales, eq(sales.id, salePayments.saleId)).where(and(eq(sales.orgId, orgId), eq(sales.businessDate, today))).groupBy(salePayments.method),
    glBalance(orgId, SYS.CASH_DRAWER),
    glBalance(orgId, SYS.AR),
    db.select({ id: shifts.id, v: shifts.varianceCents, at: shifts.closedAt }).from(shifts).where(and(eq(shifts.orgId, orgId), eq(shifts.status, "closed"), sql`${shifts.varianceCents} <> 0`, sql`${shifts.closedAt} > now() - interval '7 days'`)).limit(5),
    db.select({ day: sales.businessDate, total: sql<string>`sum(${sales.totalCents})`, n: sql<number>`count(*)::int` }).from(sales).where(and(eq(sales.orgId, orgId), gte(sales.businessDate, since))).groupBy(sales.businessDate),
    db.select({ method: salePayments.method, total: sql<string>`sum(${salePayments.amountCents})` }).from(salePayments).innerJoin(sales, eq(sales.id, salePayments.saleId)).where(and(eq(sales.orgId, orgId), gte(sales.businessDate, monthStart))).groupBy(salePayments.method),
    db
      .select({ id: sales.id, receiptNo: sales.receiptNo, token: sales.receiptToken, total: sales.totalCents, status: sales.status, at: sales.createdAt, customer: customers.name, business: customers.businessName, cashier: members.name })
      .from(sales)
      .innerJoin(customers, eq(customers.id, sales.customerId))
      .leftJoin(members, eq(members.id, sales.memberId))
      .where(eq(sales.orgId, orgId))
      .orderBy(desc(sales.id))
      .limit(6),
  ]);

  const salesToday = Number(todays.total);
  const marginPct = salesToday > 0 ? Math.round(((salesToday - Number(todays.cost)) / salesToday) * 100) : null;
  const tender = (m: string) => Number(tenders.find((t) => t.method === m)?.total ?? 0);
  const showCosts = can(s.role, "catalog.view_costs");
  const hour = Number(new Intl.DateTimeFormat("en-KE", { hour: "numeric", hour12: false, timeZone: "Africa/Nairobi" }).format(new Date()));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const byDay = new Map(daily.map((d) => [d.day, d]));
  const trend = Array.from({ length: DAYS }, (_, i) => {
    const day = daysBefore(today, DAYS - 1 - i);
    const r = byDay.get(day);
    return { label: new Date(`${day}T00:00:00Z`).toLocaleDateString("en-KE", { day: "numeric", month: "short", timeZone: "UTC" }), cents: Number(r?.total ?? 0), receipts: r?.n ?? 0 };
  });
  const trendTotal = trend.reduce((a, d) => a + d.cents, 0);
  const mix = ["cash", "mpesa", "credit", "points", "exchange"]
    .map((m) => ({ method: m, label: TENDER_LABELS[m], cents: Number(monthTenders.find((t) => t.method === m)?.total ?? 0) }))
    .filter((d) => d.cents > 0 || ["cash", "mpesa", "credit"].includes(d.method));

  const attention = [
    {
      title: "Running low",
      n: lowStock.length,
      body:
        lowStock.length === 0 ? null : (
          <ul className="space-y-1.5">
            {lowStock.slice(0, 5).map((r, i) => (
              <li key={i} className="text-[12.5px] flex justify-between gap-2">
                <span className="truncate">{r.name}{r.option ? <span className="text-ink-400"> · {r.option}</span> : null}</span>
                <span className={`tnum shrink-0 ${r.qty <= 0 ? "text-bad" : "text-warn"}`}>{r.qty} left</span>
              </li>
            ))}
          </ul>
        ),
    },
    ...(can(s.role, "reports.view")
      ? [{
          title: "Tills that didn't balance",
          n: shortShifts.length,
          body:
            shortShifts.length === 0 ? null : (
              <ul className="space-y-1.5">
                {shortShifts.map((x) => (
                  <li key={x.id} className="text-[12.5px] flex justify-between gap-2">
                    <Link href={`/sales/shifts/${x.id}`} className="text-brand-700 hover:underline truncate">{x.at?.toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium" })}</Link>
                    <span className={`tnum shrink-0 ${x.v! < 0 ? "text-bad" : "text-warn"}`}>{x.v! < 0 ? "short" : "over"} {(Math.abs(x.v!) / 100).toLocaleString("en-KE")}</span>
                  </li>
                ))}
              </ul>
            ),
        }]
      : []),
    ...(can(s.role, "catalog.set_prices")
      ? [{
          title: "Price suggestions",
          n: pending.n,
          body:
            pending.n === 0 ? null : (
              <p className="text-[12.5px] text-ink-600">
                {pending.n} from staff. <Link className="text-brand-700 hover:underline" href="/products/prices">Review</Link>
              </p>
            ),
        }]
      : []),
    {
      title: "Owed by customers",
      n: null,
      body:
        Number(owed.b) === 0 ? null : (
          <p className="text-[12.5px] text-ink-600">
            <Money cents={Number(owed.b)} className="font-medium text-ink-900" /> on account. <Link href="/customers?type=credit" className="text-brand-700 hover:underline">Credit customers</Link>
          </p>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{greeting}, {s.member.name.split(" ")[0] || "there"}</h1>
          <p className="text-ink-500 text-sm mt-1">Here is how the shop is doing today.</p>
        </div>
        <div className="text-[11.5px] text-ink-400 shrink-0 pb-1 hidden sm:block">
          {new Date().toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi", weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </div>
      </div>

      {/* Needs attention */}
      <div className="card p-5">
        <h2 className="text-[13.5px] font-semibold mb-4">Needs attention</h2>
        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-5 ${attention.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
          {attention.map((a) => (
            <div key={a.title} className="min-w-0">
              <div className="text-[11px] font-medium text-ink-400 uppercase tracking-wide mb-2">
                {a.title}{a.n !== null ? ` · ${a.n}` : ""}
              </div>
              {a.body ?? <div className="text-[12px] text-ink-400">Nothing needs attention.</div>}
            </div>
          ))}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          label="Sales today"
          value={kes(salesToday)}
          sub={todays.n ? `${todays.n} receipt${todays.n === 1 ? "" : "s"} · avg ${kes(Math.round(salesToday / todays.n))}` : "No sales yet today"}
        />
        {showCosts ? (
          <Stat label="Gross margin today" value={marginPct === null ? "—" : `${marginPct}%`} sub="after the cost of what was sold" subTone={marginPct === null ? "muted" : marginPct >= 25 ? "good" : "warn"} />
        ) : (
          <Stat label="Owed by customers" value={kes(Number(owed.b))} sub="on account, all customers" />
        )}
        <Stat label="Cash in the drawer" value={kes(Number(drawer.b))} sub={`M-Pesa today ${kes(tender("mpesa"))}`} />
        <Stat label="Sold on account today" value={kes(tender("credit"))} sub={<Link href="/customers?type=credit" className="text-brand-700 hover:underline">Credit customers</Link>} />
      </div>

      {/* Takings + how people paid */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 card p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-[13.5px] font-semibold">Sales</h2>
            <span className="text-[11.5px] text-ink-400">last {DAYS} days · {kes(trendTotal)}</span>
          </div>
          <SalesTrendChart data={trend} color={s.org.brandColor} />
        </div>
        <div className="lg:col-span-2 card p-5">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-[13.5px] font-semibold">How customers paid</h2>
            <span className="text-[11.5px] text-ink-400">this month</span>
          </div>
          <TenderDonut data={mix} color={s.org.brandColor} />
        </div>
      </div>

      {/* Stock */}
      <div className={`grid grid-cols-1 gap-4 ${showCosts ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <Stat label="Products" value={String(productCount.n)} sub="active in the catalogue" />
        <Stat label="Units on the shelf" value={Number(stock.units).toLocaleString("en-KE")} sub={`${lowStock.length} item${lowStock.length === 1 ? "" : "s"} at or below reorder level`} subTone={lowStock.length ? "warn" : "good"} />
        {showCosts && <Stat label="Stock value at cost" value={kes(Number(stock.value))} sub="matches the Inventory account" />}
      </div>

      {/* Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="Recent sales" aside={can(s.role, "reports.view") ? <Link href="/sales/history" className="font-medium text-brand-700 hover:underline">View all</Link> : undefined} bodyClassName="">
          <table className="w-full text-left text-[12.5px]">
            <tbody className="divide-y divide-ink-100 border-t border-ink-100">
              {recent.map((r) => (
                <tr key={r.id}>
                  <td className="px-5 py-2.5">
                    <a href={`/r/${r.token}`} target="_blank" rel="noreferrer" className="font-medium hover:underline">{r.receiptNo}</a>
                    <div className="text-[11px] text-ink-400 truncate max-w-[180px]">{r.business || r.customer || "Walk-in"} · {r.cashier || "—"}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    {r.status !== "completed" && (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[10.5px] font-medium border bg-amber-50 text-amber-700 border-amber-200">{r.status === "returned" ? "Returned" : "Part returned"}</span>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-right whitespace-nowrap">
                    <div className="font-medium tnum">{fmtKES(r.total)}</div>
                    <div className="text-[11px] text-ink-400 tnum">{r.at.toLocaleTimeString("en-KE", { timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit" })}</div>
                  </td>
                </tr>
              ))}
              {recent.length === 0 && (
                <tr><td className="px-5 py-8 text-center text-ink-400">No sales yet. They&apos;ll appear here as the till rings them up.</td></tr>
              )}
            </tbody>
          </table>
        </Panel>

        <Panel title="Running low" aside={<Link href="/stock/receive" className="font-medium text-brand-700 hover:underline">Receive stock</Link>} bodyClassName="">
          <table className="w-full text-left text-[12.5px]">
            <tbody className="divide-y divide-ink-100 border-t border-ink-100">
              {lowStock.map((r, i) => (
                <tr key={i}>
                  <td className="px-5 py-2.5">
                    <div className="font-medium truncate max-w-[220px]">{r.name}</div>
                    {r.option && <div className="text-[11px] text-ink-400 truncate max-w-[220px]">{r.option}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-ink-400 tnum whitespace-nowrap">reorder at {r.reorder}</td>
                  <td className="px-5 py-2.5 text-right whitespace-nowrap">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10.5px] font-medium border tnum ${r.qty <= 0 ? "bg-red-50 text-red-700 border-red-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>{r.qty <= 0 ? "Out" : `${r.qty} left`}</span>
                  </td>
                </tr>
              ))}
              {lowStock.length === 0 && (
                <tr><td className="px-5 py-8 text-center text-ink-400">Nothing is below its reorder level.</td></tr>
              )}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}
