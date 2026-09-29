import { and, asc, desc, eq, gte, ne } from "drizzle-orm";
import { db, accounts, expenses } from "@/db";
import { requirePage } from "@/lib/auth";
import { MONEY_ACCOUNTS } from "@/lib/money-ops";
import { nairobiDate } from "@/lib/time";
import { Money, PageHeader } from "@/components/ui";
import { ExpenseForm } from "../forms";

export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
  const s = await requirePage("books.post");
  const [accts, rows] = await Promise.all([
    db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(and(eq(accounts.orgId, s.org.id), eq(accounts.type, "expense"), ne(accounts.subtype, "cogs"), eq(accounts.archived, false), gte(accounts.code, "6000"))).orderBy(asc(accounts.code)),
    db.select({ e: expenses, account: accounts.name }).from(expenses).innerJoin(accounts, eq(accounts.id, expenses.accountId)).where(eq(expenses.orgId, s.org.id)).orderBy(desc(expenses.date), desc(expenses.id)).limit(100),
  ]);
  return (
    <>
      <PageHeader title="Expenses" subtitle="Rent, electricity, transport and other running costs paid outside the till." />
      <div className="grid gap-5 lg:grid-cols-[1fr_360px] items-start">
        <div className="card overflow-x-auto">
          {rows.length === 0 ? <p className="p-6 text-[13.5px] text-ink-400">No expenses yet. Cash spent from the till is recorded at the till (More → Cash in / out).</p> : (
            <table className="w-full text-[13.5px]">
              <tbody>
                {rows.map(({ e, account }) => (
                  <tr key={e.id} className="hairline-t">
                    <td className="px-4 py-2.5 tnum text-ink-600 whitespace-nowrap">{e.date}</td>
                    <td className="px-4 py-2.5"><div className="font-medium">{e.description}</div><div className="text-[12px] text-ink-400">{account} · {MONEY_ACCOUNTS[e.paidFrom as keyof typeof MONEY_ACCOUNTS]?.label}{e.reference ? ` · ${e.reference}` : ""}</div></td>
                    <td className="px-4 py-2.5 text-right"><Money cents={e.amountCents} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <ExpenseForm accounts={accts} today={nairobiDate()} />
      </div>
    </>
  );
}
