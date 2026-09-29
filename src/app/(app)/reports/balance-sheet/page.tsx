import { db } from "@/db";
import { inOrg, requirePage } from "@/lib/auth";
import { balanceSheet } from "@/lib/reports";
import { nairobiDate } from "@/lib/time";
import { Card, PageHeader, Pill } from "@/components/ui";
import { isDate, RangeForm, SectionTable, TotalRow } from "@/components/report";

export const dynamic = "force-dynamic";

export default async function BalanceSheetPage({ searchParams }: { searchParams: Promise<{ asOf?: string }> }) {
  const s = await requirePage("reports.view");
  const sp = await searchParams;
  const asOf = isDate(sp.asOf) ? sp.asOf! : nairobiDate();
  const r = await inOrg(s, () => balanceSheet(db, asOf));
  return (
    <>
      <PageHeader title="Balance sheet" subtitle={`${s.org.name} · as at ${asOf}`} actions={r.balanced ? <Pill tone="good">Balances</Pill> : <Pill tone="bad">Doesn't balance</Pill>} />
      <RangeForm to={asOf} exportHref={`/reports/export?kind=bs&asOf=${asOf}`} />
      <div className="grid gap-5 lg:grid-cols-2 items-start max-w-5xl">
        <Card className="p-6 grid gap-1">
          <SectionTable section={r.assets} to={asOf} />
          <TotalRow label="Total assets" cents={r.assets.totalCents} strong />
        </Card>
        <Card className="p-6 grid gap-1">
          <SectionTable section={r.liabilities} to={asOf} />
          <TotalRow label="Total owed" cents={r.liabilities.totalCents} />
          <SectionTable section={r.equity} to={asOf} />
          <div className="flex justify-between text-[13.5px]"><span>Profit to date</span><span className="tnum">{(r.profitToDateCents / 100).toLocaleString("en-KE", { minimumFractionDigits: 2 })}</span></div>
          <TotalRow label="Owner's stake" cents={r.totalEquityCents} />
          <TotalRow label="Total owed + owner's stake" cents={r.liabilities.totalCents + r.totalEquityCents} strong />
        </Card>
      </div>
    </>
  );
}
