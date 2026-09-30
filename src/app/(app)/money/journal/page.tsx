import { and, asc, desc, eq } from "drizzle-orm";
import { db, accounts, journalEntries } from "@/db";
import { requirePage } from "@/lib/auth";
import { SYS } from "@/lib/coa";
import { nairobiDate } from "@/lib/time";
import { PageHeader } from "@/components/ui";
import { JournalForm } from "../forms";

export const dynamic = "force-dynamic";

const PROTECTED = new Set<string>([SYS.INVENTORY, SYS.CASH_DRAWER, SYS.AR, SYS.AP, SYS.LOYALTY_LIABILITY, SYS.EXCHANGE_CREDIT]);

export default async function JournalPage() {
  const s = await requirePage("books.post");
  const [accts, recent] = await Promise.all([
    db.select({ id: accounts.id, code: accounts.code, name: accounts.name }).from(accounts).where(and(eq(accounts.orgId, s.org.id), eq(accounts.archived, false))).orderBy(asc(accounts.code)),
    db.select().from(journalEntries).where(and(eq(journalEntries.orgId, s.org.id), eq(journalEntries.sourceType, "manual"))).orderBy(desc(journalEntries.id)).limit(20),
  ]);
  return (
    <>
      <PageHeader title="Manual journal" subtitle="For the accountant: corrections, capital, depreciation. Stock, till cash, customer and supplier balances are kept by the system and can't be journaled." />
      <div className="grid gap-5 lg:grid-cols-[1fr_320px] items-start">
        <JournalForm accounts={accts.filter((a) => !PROTECTED.has(a.code))} today={nairobiDate()} />
        <div className="card p-5 grid gap-2">
          <h2 className="text-[13.5px] font-semibold">Recent journals</h2>
          {recent.length === 0 ? <p className="text-[13px] text-ink-400">None yet.</p> : recent.map((j) => (
            <div key={j.id} className="text-[13px]"><span className="tnum text-ink-400">{j.date}</span> {j.memo}</div>
          ))}
        </div>
      </div>
    </>
  );
}
