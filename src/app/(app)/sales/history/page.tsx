import Link from "next/link";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { db, customers, members, salePayments, sales } from "@/db";
import { requirePage } from "@/lib/auth";
import { maskPhone, normalizeKenyanPhone } from "@/lib/phone";
import { nairobiDate } from "@/lib/time";
import { Money, PageHeader, Pill } from "@/components/ui";

export const dynamic = "force-dynamic";

const TENDER: Record<string, string> = { cash: "Cash", mpesa: "M-Pesa", credit: "Account", points: "Points", exchange: "Exchange" };
const isDate = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function SalesHistoryPage({ searchParams }: { searchParams: Promise<{ q?: string; from?: string; to?: string; cashier?: string }> }) {
  const s = await requirePage("reports.view");
  const sp = await searchParams;
  const today = nairobiDate();
  const to = isDate(sp.to) ? sp.to! : today;
  const from = isDate(sp.from) ? sp.from! : new Date(Date.parse(today) - 6 * 86_400_000).toISOString().slice(0, 10);
  const q = (sp.q ?? "").trim();
  const conds = [eq(sales.orgId, s.org.id)];
  const phone = normalizeKenyanPhone(q);
  if (/^KF-?\d+$/i.test(q)) conds.push(eq(sales.receiptNo, `KF-${q.replace(/\D/g, "").padStart(6, "0")}`));
  else {
    conds.push(gte(sales.businessDate, from), lte(sales.businessDate, to));
    if (phone) conds.push(eq(customers.phone, phone));
    else if (/^[A-Za-z0-9]{10}$/.test(q)) conds.push(sql`exists (select 1 from sale_payments p where p.sale_id = "sales"."id" and p.mpesa_code = ${q.toUpperCase()})`);
    else if (q) conds.push(or(ilike(customers.name, `%${q}%`), ilike(customers.businessName, `%${q}%`))!);
  }
  if (sp.cashier) conds.push(eq(sales.memberId, Number(sp.cashier)));

  const [rows, staff] = await Promise.all([
    db
      .select({ sale: sales, name: customers.name, biz: customers.businessName, phone: customers.phone, cashier: members.name })
      .from(sales)
      .innerJoin(customers, eq(customers.id, sales.customerId))
      .leftJoin(members, eq(members.id, sales.memberId))
      .where(and(...conds))
      .orderBy(desc(sales.createdAt))
      .limit(300),
    db.select({ id: members.id, name: members.name, email: members.email }).from(members).where(eq(members.orgId, s.org.id)),
  ]);
  const pays = rows.length ? await db.select().from(salePayments).where(inArray(salePayments.saleId, rows.map((r) => r.sale.id))) : [];
  const total = rows.reduce((a, r) => a + r.sale.totalCents, 0);

  return (
    <>
      <PageHeader title="Sales" subtitle={q && /^KF-?\d+$/i.test(q) ? `Receipt ${q.toUpperCase()}` : `${from} to ${to} · ${rows.length} sale${rows.length === 1 ? "" : "s"} · KES ${(total / 100).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`} />
      <form className="flex flex-wrap items-end gap-2 mb-5">
        <label className="grid gap-1 text-[12px] text-ink-400">Search<input name="q" defaultValue={q} placeholder="Receipt, phone, M-Pesa code, name" className="h-9 w-72 rounded-lg bg-white px-3 text-[13.5px] border border-ink-200" /></label>
        <label className="grid gap-1 text-[12px] text-ink-400">From<input type="date" name="from" defaultValue={from} className="h-9 rounded-lg bg-white px-2 text-[13.5px] border border-ink-200" /></label>
        <label className="grid gap-1 text-[12px] text-ink-400">To<input type="date" name="to" defaultValue={to} className="h-9 rounded-lg bg-white px-2 text-[13.5px] border border-ink-200" /></label>
        <label className="grid gap-1 text-[12px] text-ink-400">Cashier
          <select name="cashier" defaultValue={sp.cashier ?? ""} className="h-9 rounded-lg bg-white px-2 text-[13.5px] border border-ink-200">
            <option value="">Everyone</option>
            {staff.map((m) => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
          </select>
        </label>
        <button className="h-9 px-4 rounded-lg bg-brand text-brand-ink text-[13px] font-medium cursor-pointer">Show</button>
      </form>
      <div className="card overflow-x-auto">
        <table className="w-full text-[13.5px]">
          <thead><tr className="text-left text-[11px] uppercase tracking-wider text-ink-400"><th className="px-4 py-3 font-semibold">Receipt</th><th className="px-4 py-3 font-semibold">Customer</th><th className="px-4 py-3 font-semibold">Paid by</th><th className="px-4 py-3 font-semibold text-right">Total</th><th className="px-4 py-3" /></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-ink-400">No sales match.</td></tr>}
            {rows.map(({ sale, name, biz, phone: ph, cashier }) => {
              const p = pays.filter((x) => x.saleId === sale.id);
              return (
                <tr key={sale.id} className="hairline-t">
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{sale.receiptNo}</div>
                    <div className="text-[12px] text-ink-400">{sale.createdAt.toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" })} · {cashier || "Staff"}</div>
                  </td>
                  <td className="px-4 py-2.5">{biz || name || "—"}<div className="text-[12px] text-ink-400 tnum">{maskPhone(ph)}{sale.priceLevel === "wholesale" ? " · wholesale" : ""}</div></td>
                  <td className="px-4 py-2.5 text-[12.5px] text-ink-600">{p.map((x) => `${TENDER[x.method] ?? x.method}${x.mpesaCode ? ` ${x.mpesaCode}` : ""}`).join(", ")}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Money cents={sale.totalCents} />
                    {sale.status !== "completed" && <div className="mt-1"><Pill tone="warn">{sale.status === "returned" ? "Returned" : "Part returned"}</Pill></div>}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap text-[12.5px]">
                    <a href={`/r/${sale.receiptToken}`} target="_blank" className="underline text-ink-600 mr-3">Open</a>
                    <a href={`/r/${sale.receiptToken}?print=1`} target="_blank" className="underline text-ink-600">Print</a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-ink-400 mt-3">Showing up to 300 sales. Narrow the dates or search to find older ones. <Link href="/reports/sales" className="underline">Sales analysis</Link> has the totals.</p>
    </>
  );
}
