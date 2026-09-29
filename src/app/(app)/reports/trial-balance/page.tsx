import Link from "next/link";
import { db } from "@/db";
import { inOrg, requirePage } from "@/lib/auth";
import { trialBalance } from "@/lib/reports";
import { nairobiDate } from "@/lib/time";
import { Money, PageHeader, Pill } from "@/components/ui";
import { isDate, RangeForm } from "@/components/report";

export const dynamic = "force-dynamic";

export default async function TrialBalancePage({ searchParams }: { searchParams: Promise<{ asOf?: string }> }) {
  const s = await requirePage("reports.view");
  const sp = await searchParams;
  const asOf = isDate(sp.asOf) ? sp.asOf! : nairobiDate();
  const r = await inOrg(s, () => trialBalance(db, asOf));
  return (
    <>
      <PageHeader title="Trial balance" subtitle={`As at ${asOf}`} actions={r.balanced ? <Pill tone="good">Debits = credits</Pill> : <Pill tone="bad">Out of balance</Pill>} />
      <RangeForm to={asOf} exportHref={`/reports/export?kind=tb&asOf=${asOf}`} />
      <div className="card overflow-x-auto max-w-3xl">
        <table className="w-full text-[13.5px]">
          <thead><tr className="text-left text-[11px] uppercase tracking-wider text-ink-400"><th className="px-4 py-3 font-semibold">Account</th><th className="px-4 py-3 font-semibold text-right">Debit</th><th className="px-4 py-3 font-semibold text-right">Credit</th></tr></thead>
          <tbody>
            {r.rows.map((row) => (
              <tr key={row.accountId} className="hairline-t">
                <td className="px-4 py-2"><span className="text-ink-400 tnum mr-2">{row.code}</span><Link className="hover:underline" href={`/reports/ledger/${row.accountId}?from=2000-01-01&to=${asOf}`}>{row.name}</Link></td>
                <td className="px-4 py-2 text-right">{row.debitBalance ? <Money cents={row.debitBalance} /> : ""}</td>
                <td className="px-4 py-2 text-right">{row.creditBalance ? <Money cents={row.creditBalance} /> : ""}</td>
              </tr>
            ))}
            <tr className="hairline-t font-semibold"><td className="px-4 py-3">Total</td><td className="px-4 py-3 text-right"><Money cents={r.debitCents} /></td><td className="px-4 py-3 text-right"><Money cents={r.creditCents} /></td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
