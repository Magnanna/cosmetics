import { db } from "@/db";
import { inOrg, requirePage } from "@/lib/auth";
import { profitAndLoss } from "@/lib/reports";
import { nairobiDate } from "@/lib/time";
import { Card, PageHeader } from "@/components/ui";
import { isDate, monthStart, RangeForm, SectionTable, TotalRow } from "@/components/report";

export const dynamic = "force-dynamic";

export default async function PnlPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const s = await requirePage("reports.view");
  const sp = await searchParams;
  const today = nairobiDate();
  const to = isDate(sp.to) ? sp.to! : today;
  const from = isDate(sp.from) ? sp.from! : monthStart(to);
  const r = await inOrg(s, () => profitAndLoss(db, from, to));
  return (
    <>
      <PageHeader title="Profit & loss" subtitle={`${s.org.name} · ${from} to ${to}`} />
      <RangeForm from={from} to={to} exportHref={`/reports/export?kind=pnl&from=${from}&to=${to}`} />
      <Card className="p-6 max-w-2xl grid gap-1">
        <SectionTable section={r.sales} from={from} to={to} />
        <SectionTable section={r.lessSales} from={from} to={to} />
        <TotalRow label="Net sales" cents={r.netSalesCents} />
        <SectionTable section={r.costOfSales} from={from} to={to} negate />
        <TotalRow label={`Gross profit${r.grossMarginPct !== null ? ` · ${r.grossMarginPct}% margin` : ""}`} cents={r.grossProfitCents} />
        <SectionTable section={r.expenses} from={from} to={to} negate />
        <TotalRow label="Net profit" cents={r.netProfitCents} strong tone={r.netProfitCents >= 0 ? "good" : "bad"} />
        <p className="text-[12px] text-ink-400 pt-3">Cost of sales is the FIFO cost of the stock sold, including supplier VAT (not claimable).</p>
      </Card>
    </>
  );
}
