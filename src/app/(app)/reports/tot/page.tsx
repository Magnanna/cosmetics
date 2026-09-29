import { db } from "@/db";
import { inOrg, requirePage } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { totForMonth } from "@/lib/reports";
import { nairobiDate } from "@/lib/time";
import { Money, PageHeader, Pill } from "@/components/ui";
import { PayTotForm, RecordTotButton } from "./tot-forms";

export const dynamic = "force-dynamic";

function lastMonths(today: string, n: number): string[] {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return d.toISOString().slice(0, 7);
  });
}

export default async function TotPage() {
  const s = await requirePage("reports.view");
  const today = nairobiDate();
  const months = await inOrg(s, () => Promise.all(lastMonths(today, 6).map((m) => totForMonth(db, m))));
  const canPost = can(s.role, "books.post");
  const current = today.slice(0, 7);
  return (
    <>
      <PageHeader title="Turnover Tax" subtitle={`${s.org.totRateBp / 100}% of turnover (sales after returns and discounts), filed on iTax and paid by the 20th of the next month. Confirm the basis with your accountant.`} />
      <div className="card overflow-x-auto">
        <table className="w-full text-[13.5px]">
          <thead><tr className="text-left text-[11px] uppercase tracking-wider text-ink-400"><th className="px-4 py-3 font-semibold">Month</th><th className="px-4 py-3 font-semibold text-right">Turnover</th><th className="px-4 py-3 font-semibold text-right">Tax</th><th className="px-4 py-3 font-semibold">Due</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3" /></tr></thead>
          <tbody>
            {months.map((t) => {
              const owed = t.postedCents - t.paidCents;
              const status = t.month === current ? <Pill>Month in progress</Pill> : !t.postedEntryId ? (t.taxCents > 0 ? <Pill tone="warn">Not recorded</Pill> : <Pill>Nothing due</Pill>) : owed <= 0 ? <Pill tone="good">Paid</Pill> : t.dueDate < today ? <Pill tone="bad">Overdue</Pill> : <Pill tone="warn">To pay</Pill>;
              return (
                <tr key={t.month} className="hairline-t align-top">
                  <td className="px-4 py-3 font-medium tnum">{t.month}</td>
                  <td className="px-4 py-3 text-right"><Money cents={t.turnoverCents} /></td>
                  <td className="px-4 py-3 text-right font-semibold"><Money cents={t.postedEntryId ? t.postedCents : t.taxCents} /></td>
                  <td className="px-4 py-3 tnum text-ink-600">{t.dueDate}</td>
                  <td className="px-4 py-3">{status}{t.paidCents > 0 && owed > 0 && <div className="text-[12px] text-ink-400 mt-1">Paid <Money cents={t.paidCents} /></div>}</td>
                  <td className="px-4 py-3 text-right">
                    {canPost && t.month !== current && !t.postedEntryId && t.taxCents > 0 && <RecordTotButton month={t.month} />}
                    {canPost && t.postedEntryId && owed > 0 && <PayTotForm month={t.month} owedCents={owed} today={today} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
