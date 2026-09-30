import Link from "next/link";
import { db } from "@/db";
import { inOrg, requirePage } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { DIMENSIONS, salesBy, type SalesDimension } from "@/lib/sales-reports";
import { nairobiDate } from "@/lib/time";
import { Money, PageHeader } from "@/components/ui";
import { isDate, monthStart, RangeForm } from "@/components/report";

export const dynamic = "force-dynamic";

export default async function SalesReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; by?: string }> }) {
  const s = await requirePage("reports.view");
  const sp = await searchParams;
  const to = isDate(sp.to) ? sp.to! : nairobiDate();
  const from = isDate(sp.from) ? sp.from! : monthStart(to);
  const by = (sp.by && sp.by in DIMENSIONS ? sp.by : "category") as SalesDimension;
  const rows = await inOrg(s, () => salesBy(db, from, to, by));
  const total = rows.reduce((a, r) => ({ units: a.units + r.units, net: a.net + r.netCents, cost: a.cost + r.costCents }), { units: 0, net: 0, cost: 0 });
  const max = Math.max(1, ...rows.map((r) => r.netCents));
  const costs = can(s.role, "catalog.view_costs");
  return (
    <>
      <PageHeader title="Sales analysis" subtitle={`${from} to ${to} · after returns`} />
      <RangeForm from={from} to={to} extra={<input type="hidden" name="by" value={by} />} exportHref={`/reports/export?kind=sales&from=${from}&to=${to}&by=${by}`} />
      <div className="flex flex-wrap gap-1.5 mb-4">
        {(Object.keys(DIMENSIONS) as SalesDimension[]).map((d) => (
          <Link key={d} href={`/reports/sales?from=${from}&to=${to}&by=${d}`} className={`h-8 px-3 rounded-full text-[12.5px] grid place-items-center border ${d === by ? "bg-brand-tint text-brand-700 border-transparent font-semibold" : "bg-white border-ink-200 text-ink-600"}`}>{DIMENSIONS[d]}</Link>
        ))}
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-ink-400">
              <th className="px-4 py-3 font-semibold">{DIMENSIONS[by]}</th>
              <th className="px-4 py-3 font-semibold w-1/3" />
              <th className="px-4 py-3 font-semibold text-right">Units</th>
              <th className="px-4 py-3 font-semibold text-right">Sales</th>
              {costs && <th className="px-4 py-3 font-semibold text-right">Margin</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-ink-400">No sales in this period.</td></tr>}
            {rows.map((r) => (
              <tr key={r.label} className="hairline-t">
                <td className="px-4 py-2.5">{r.label}</td>
                <td className="px-4 py-2.5"><div className="h-2 rounded-full bg-brand-tint"><div className="h-2 rounded-full bg-brand" style={{ width: `${Math.max(2, (r.netCents / max) * 100)}%` }} /></div></td>
                <td className="px-4 py-2.5 text-right tnum">{r.units}</td>
                <td className="px-4 py-2.5 text-right"><Money cents={r.netCents} /></td>
                {costs && <td className="px-4 py-2.5 text-right tnum">{r.marginPct === null ? "—" : `${r.marginPct}%`}</td>}
              </tr>
            ))}
            {rows.length > 0 && (
              <tr className="hairline-t font-semibold">
                <td className="px-4 py-3">Total</td><td />
                <td className="px-4 py-3 text-right tnum">{total.units}</td>
                <td className="px-4 py-3 text-right"><Money cents={total.net} /></td>
                {costs && <td className="px-4 py-3 text-right tnum">{total.net > 0 ? `${Math.round(((total.net - total.cost) / total.net) * 1000) / 10}%` : "—"}</td>}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
