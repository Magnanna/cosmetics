import { desc, eq, sql } from "drizzle-orm";
import { db, accounts, journalLines, moneyTransfers } from "@/db";
import { inOrg, requirePage } from "@/lib/auth";
import { SYS } from "@/lib/coa";
import { nairobiDate } from "@/lib/time";
import { Card, Money, PageHeader } from "@/components/ui";
import { TransferForm } from "../forms";

export const dynamic = "force-dynamic";

const NAMES: Record<string, string> = { [SYS.CASH_AT_HAND]: "Cash at hand", [SYS.MPESA_TILL]: "M-Pesa", [SYS.BANK]: "Bank" };

export default async function TransfersPage() {
  const s = await requirePage("books.post");
  const [rows, bal] = await Promise.all([
    db.select().from(moneyTransfers).where(eq(moneyTransfers.orgId, s.org.id)).orderBy(desc(moneyTransfers.date), desc(moneyTransfers.id)).limit(100),
    inOrg(s, () =>
      db
        .select({ code: accounts.code, b: sql<string>`coalesce(sum(${journalLines.debitCents} - ${journalLines.creditCents}),0)` })
        .from(accounts)
        .leftJoin(journalLines, eq(journalLines.accountId, accounts.id))
        .where(sql`${accounts.orgId} = ${s.org.id} and ${accounts.code} in (${SYS.CASH_DRAWER}, ${SYS.CASH_AT_HAND}, ${SYS.MPESA_TILL}, ${SYS.BANK})`)
        .groupBy(accounts.code)
    ),
  ]);
  const b = (code: string) => Number(bal.find((x) => x.code === code)?.b ?? 0);
  return (
    <>
      <PageHeader title="Money" subtitle="Where the shop's money is right now, and moving it between places." />
      <div className="grid gap-4 sm:grid-cols-4 mb-5">
        {[[SYS.CASH_DRAWER, "In the till drawer"], [SYS.CASH_AT_HAND, "Cash at hand"], [SYS.MPESA_TILL, "M-Pesa"], [SYS.BANK, "Bank"]].map(([code, label]) => (
          <Card key={code} className="p-5 grid gap-1"><span className="text-[12.5px] text-ink-400">{label} (KES)</span><Money cents={b(code)} className="money-lg" /></Card>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_380px] items-start">
        <div className="card overflow-x-auto">
          {rows.length === 0 ? <p className="p-6 text-[13.5px] text-ink-400">No transfers yet.</p> : (
            <table className="w-full text-[13.5px]"><tbody>
              {rows.map((t) => (
                <tr key={t.id} className="hairline-t">
                  <td className="px-4 py-2.5 tnum text-ink-600">{t.date}</td>
                  <td className="px-4 py-2.5">{NAMES[t.fromCode]} → {NAMES[t.toCode]}{t.note ? <span className="text-ink-400"> · {t.note}</span> : null}</td>
                  <td className="px-4 py-2.5 text-right"><Money cents={t.amountCents} />{t.feeCents > 0 && <div className="text-[12px] text-ink-400">fee <Money cents={t.feeCents} /></div>}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
        <TransferForm today={nairobiDate()} />
      </div>
    </>
  );
}
