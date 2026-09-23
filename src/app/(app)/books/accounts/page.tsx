import { and, asc, eq, sql } from "drizzle-orm";
import { db, accounts, journalLines } from "@/db";
import { requirePage } from "@/lib/auth";
import { Money, PageHeader } from "@/components/ui";

const GROUPS = [
  { type: "asset", label: "What the shop owns" },
  { type: "liability", label: "What the shop owes" },
  { type: "equity", label: "Owner's stake" },
  { type: "income", label: "Money coming in" },
  { type: "expense", label: "Money going out" },
] as const;

export default async function AccountsPage() {
  const s = await requirePage("books.view");
  const rows = await db
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      description: accounts.description,
      dr: sql<string>`coalesce(sum(${journalLines.debitCents}),0)`,
      cr: sql<string>`coalesce(sum(${journalLines.creditCents}),0)`,
    })
    .from(accounts)
    .leftJoin(journalLines, eq(journalLines.accountId, accounts.id))
    .where(and(eq(accounts.orgId, s.org.id), eq(accounts.archived, false)))
    .groupBy(accounts.id)
    .orderBy(asc(accounts.code));

  // Natural balance: assets & expenses are debit-normal, the rest credit-normal.
  const balance = (r: (typeof rows)[number]) => {
    const net = Number(r.dr) - Number(r.cr);
    return r.type === "asset" || r.type === "expense" ? net : -net;
  };

  return (
    <>
      <PageHeader title="Chart of accounts" subtitle="Every sale, bill and cash movement lands in one of these." />
      <div className="grid gap-5">
        {GROUPS.map((g) => (
          <div key={g.type} className="card overflow-x-auto">
            <div className="px-4 pt-4 pb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">{g.label}</div>
            <table className="w-full text-[13.5px]">
              <tbody>
                {rows.filter((r) => r.type === g.type).map((r) => (
                  <tr key={r.id} className="hairline-t">
                    <td className="px-4 py-2.5 w-16 tnum text-ink-400">{r.code}</td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-[12px] text-ink-400">{r.description}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap"><Money cents={balance(r)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </>
  );
}
