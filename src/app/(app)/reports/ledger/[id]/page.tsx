import { notFound } from "next/navigation";
import { db } from "@/db";
import { inOrg, requirePage } from "@/lib/auth";
import { accountLedger } from "@/lib/reports";
import { nairobiDate } from "@/lib/time";
import { Money, PageHeader } from "@/components/ui";
import { isDate, monthStart, RangeForm } from "@/components/report";

export const dynamic = "force-dynamic";

export default async function LedgerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const s = await requirePage("books.view");
  const id = Number((await params).id);
  const sp = await searchParams;
  const to = isDate(sp.to) ? sp.to! : nairobiDate();
  const from = isDate(sp.from) ? sp.from! : monthStart(to);
  const r = await inOrg(s, () => accountLedger(db, id, from, to));
  if (!r) notFound();
  return (
    <>
      <PageHeader title={r.account.name} subtitle={`${r.account.code} · ${r.account.description ?? ""}`} />
      <RangeForm from={from} to={to} />
      <div className="card overflow-x-auto">
        <table className="w-full text-[13.5px]">
          <thead><tr className="text-left text-[11px] uppercase tracking-wider text-ink-400"><th className="px-4 py-3 font-semibold">Date</th><th className="px-4 py-3 font-semibold">Details</th><th className="px-4 py-3 font-semibold text-right">In (Dr)</th><th className="px-4 py-3 font-semibold text-right">Out (Cr)</th><th className="px-4 py-3 font-semibold text-right">Balance</th></tr></thead>
          <tbody>
            <tr className="hairline-t text-ink-600"><td className="px-4 py-2 tnum">{from}</td><td className="px-4 py-2">Opening balance</td><td /><td /><td className="px-4 py-2 text-right"><Money cents={r.openingCents} /></td></tr>
            {r.lines.map((l, i) => (
              <tr key={i} className="hairline-t">
                <td className="px-4 py-2 tnum whitespace-nowrap">{l.date}</td>
                <td className="px-4 py-2">{l.memo}{l.lineMemo && l.lineMemo !== l.memo ? <span className="text-ink-400"> · {l.lineMemo}</span> : null}</td>
                <td className="px-4 py-2 text-right">{l.dr ? <Money cents={l.dr} /> : ""}</td>
                <td className="px-4 py-2 text-right">{l.cr ? <Money cents={l.cr} /> : ""}</td>
                <td className="px-4 py-2 text-right"><Money cents={l.balanceCents} /></td>
              </tr>
            ))}
            <tr className="hairline-t font-semibold"><td className="px-4 py-3" colSpan={4}>Closing balance</td><td className="px-4 py-3 text-right"><Money cents={r.closingCents} /></td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
