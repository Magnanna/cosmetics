import { and, desc, eq, inArray } from "drizzle-orm";
import { db, mpesaImports, mpesaStatementLines, sales } from "@/db";
import { inOrg, requirePage } from "@/lib/auth";
import { missingFromStatement } from "@/lib/mpesa-reconcile";
import { Money, PageHeader, Pill } from "@/components/ui";
import { MpesaUpload } from "../forms";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
  matched: { label: "Matched", tone: "good" },
  amount_mismatch: { label: "Wrong amount", tone: "bad" },
  not_in_pos: { label: "Not recorded at till", tone: "warn" },
  withdrawal: { label: "Withdrawal", tone: "neutral" },
};

export default async function MpesaPage() {
  const s = await requirePage("books.view");
  const imports = await db.select().from(mpesaImports).where(eq(mpesaImports.orgId, s.org.id)).orderBy(desc(mpesaImports.id)).limit(10);
  const problems = await db
    .select({ l: mpesaStatementLines, receiptNo: sales.receiptNo })
    .from(mpesaStatementLines)
    .leftJoin(sales, eq(sales.id, mpesaStatementLines.saleId))
    .where(and(eq(mpesaStatementLines.orgId, s.org.id), inArray(mpesaStatementLines.status, ["amount_mismatch", "not_in_pos"])))
    .orderBy(desc(mpesaStatementLines.completedAt))
    .limit(100);
  const range = imports.length ? { from: imports.map((i) => i.fromDate!).sort()[0], to: imports.map((i) => i.toDate!).sort().at(-1)! } : null;
  const missing = range ? await inOrg(s, () => missingFromStatement(db, range.from, range.to)) : [];
  return (
    <>
      <PageHeader title="M-Pesa check" subtitle="Import the till statement to confirm every M-Pesa code typed at the till really came in." />
      <div className="grid gap-5 lg:grid-cols-[1fr_340px] items-start">
        <div className="grid gap-5">
          <div className="card overflow-x-auto">
            <div className="px-4 pt-4 pb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Needs a look</div>
            {problems.length === 0 && missing.length === 0 ? <p className="px-4 pb-5 text-[13.5px] text-ink-400">{imports.length ? "Everything matches." : "Import a statement to start."}</p> : (
              <table className="w-full text-[13.5px]"><tbody>
                {problems.map(({ l, receiptNo }) => (
                  <tr key={l.id} className="hairline-t">
                    <td className="px-4 py-2.5 tnum">{l.code}<div className="text-[12px] text-ink-400">{l.completedAt}</div></td>
                    <td className="px-4 py-2.5 text-[12.5px] text-ink-600">{l.details}{receiptNo ? ` · sale ${receiptNo}` : ""}</td>
                    <td className="px-4 py-2.5 text-right"><Money cents={l.paidInCents} />{l.posAmountCents !== null && <div className="text-[12px] text-bad">till said <Money cents={l.posAmountCents} /></div>}</td>
                    <td className="px-4 py-2.5 text-right"><Pill tone={STATUS[l.status].tone}>{STATUS[l.status].label}</Pill></td>
                  </tr>
                ))}
                {missing.map((m) => (
                  <tr key={m.code} className="hairline-t">
                    <td className="px-4 py-2.5 tnum">{m.code}<div className="text-[12px] text-ink-400">{m.date}</div></td>
                    <td className="px-4 py-2.5 text-[12.5px] text-ink-600">Typed at the till on {m.receiptNo}</td>
                    <td className="px-4 py-2.5 text-right"><Money cents={m.amountCents} /></td>
                    <td className="px-4 py-2.5 text-right"><Pill tone="bad">Not on statement</Pill></td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </div>
          {imports.length > 0 && (
            <div className="card p-4 grid gap-1 text-[13px]">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Imported</div>
              {imports.map((i) => <div key={i.id}>{i.fileName} · {i.rowCount} lines · {i.fromDate} to {i.toDate}</div>)}
            </div>
          )}
        </div>
        <MpesaUpload />
      </div>
    </>
  );
}
