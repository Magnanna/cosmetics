import { db } from "@/db";
import { inOrg, requirePage } from "@/lib/auth";
import { stockReport } from "@/lib/sales-reports";
import { nairobiDate } from "@/lib/time";
import { Card, Money, PageHeader, Pill } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function StockReportPage() {
  const s = await requirePage("catalog.view_costs");
  const rows = await inOrg(s, () => stockReport(db));
  const today = nairobiDate();
  const cutoff = new Date(Date.parse(today) - 60 * 86_400_000).toISOString().slice(0, 10);
  const inStock = rows.filter((r) => r.qty !== 0);
  const slow = inStock.filter((r) => r.qty > 0 && (!r.lastSold || r.lastSold < cutoff));
  const totalCost = inStock.reduce((a, r) => a + r.costCents, 0);
  const totalRetail = inStock.reduce((a, r) => a + r.retailCents, 0);
  return (
    <>
      <PageHeader title="Stock value" subtitle="Valued at what you paid (FIFO, including supplier VAT). This always equals the Inventory account." />
      <div className="grid gap-4 sm:grid-cols-3 mb-5">
        <Card className="p-5 grid gap-1"><span className="text-[12.5px] text-ink-400">At cost (KES)</span><Money cents={totalCost} className="money-lg" /></Card>
        <Card className="p-5 grid gap-1"><span className="text-[12.5px] text-ink-400">At retail price (KES)</span><Money cents={totalRetail} className="money-lg" /></Card>
        <Card className="p-5 grid gap-1"><span className="text-[12.5px] text-ink-400">Not sold in 60 days (KES at cost)</span><Money cents={slow.reduce((a, r) => a + r.costCents, 0)} className="money-lg text-warn" /><span className="text-[12px] text-ink-400">{slow.length} products</span></Card>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-[13.5px]">
          <thead><tr className="text-left text-[11px] uppercase tracking-wider text-ink-400"><th className="px-4 py-3 font-semibold">Product</th><th className="px-4 py-3 font-semibold text-right">On hand</th><th className="px-4 py-3 font-semibold text-right">Cost value</th><th className="px-4 py-3 font-semibold text-right">Retail value</th><th className="px-4 py-3 font-semibold text-right">Last sold</th></tr></thead>
          <tbody>
            {inStock.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-ink-400">No stock yet.</td></tr>}
            {inStock.map((r) => (
              <tr key={r.variantId} className="hairline-t">
                <td className="px-4 py-2.5">{r.name}{r.brand && <span className="text-ink-400"> · {r.brand}</span>}</td>
                <td className={`px-4 py-2.5 text-right tnum ${r.qty < 0 ? "text-bad" : ""}`}>{r.qty}</td>
                <td className="px-4 py-2.5 text-right"><Money cents={r.costCents} /></td>
                <td className="px-4 py-2.5 text-right"><Money cents={r.retailCents} /></td>
                <td className="px-4 py-2.5 text-right text-ink-600 tnum">{r.lastSold ?? "Never"}{r.qty > 0 && (!r.lastSold || r.lastSold < cutoff) && <span className="ml-2"><Pill tone="warn">Slow</Pill></span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
