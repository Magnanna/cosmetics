import { and, asc, desc, eq } from "drizzle-orm";
import { db, customers, journalEntries, suppliers } from "@/db";
import { requirePage } from "@/lib/auth";
import { nairobiDate } from "@/lib/time";
import { PageHeader } from "@/components/ui";
import { OpeningForm } from "../forms";

export const dynamic = "force-dynamic";

export default async function OpeningPage() {
  const s = await requirePage("books.post");
  const [sups, custs, done] = await Promise.all([
    db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.orgId, s.org.id)).orderBy(asc(suppliers.name)),
    db.select({ id: customers.id, name: customers.name, biz: customers.businessName, phone: customers.phone }).from(customers).where(and(eq(customers.orgId, s.org.id), eq(customers.creditEnabled, true))).orderBy(asc(customers.name)),
    db.select().from(journalEntries).where(and(eq(journalEntries.orgId, s.org.id), eq(journalEntries.sourceType, "opening_balance"))).orderBy(desc(journalEntries.id)),
  ]);
  return (
    <>
      <PageHeader title="Opening balances" subtitle="What the shop had and owed on the day it started using Kenfri POS. Opening stock is entered with each product (units and cost)." />
      <div className="grid gap-5 lg:grid-cols-[1fr_380px] items-start">
        <div className="card p-5 grid gap-2">
          <h2 className="text-[15px] font-semibold">Entered so far</h2>
          {done.length === 0 ? <p className="text-[13px] text-ink-400">Nothing yet. Start with cash at hand, the M-Pesa till balance and the bank balance.</p> : done.map((j) => (
            <div key={j.id} className="text-[13.5px]"><span className="tnum text-ink-400">{j.date}</span> {j.memo}</div>
          ))}
        </div>
        <OpeningForm suppliers={sups} customers={custs.map((c) => ({ id: c.id, name: c.biz || c.name || c.phone }))} today={nairobiDate()} />
      </div>
    </>
  );
}
