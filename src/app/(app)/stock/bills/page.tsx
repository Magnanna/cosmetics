import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, bills, suppliers } from "@/db";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { nairobiDate } from "@/lib/time";
import { Button, EmptyState, Money, PageHeader, Pill } from "@/components/ui";
import { PayForm } from "./pay-form";

export const dynamic = "force-dynamic";

export default async function BillsPage() {
  const s = await requirePage("stock.receive");
  const today = nairobiDate();
  const [rows, owed] = await Promise.all([
    db
      .select({ bill: bills, supplier: suppliers.name })
      .from(bills)
      .innerJoin(suppliers, eq(suppliers.id, bills.supplierId))
      .where(eq(bills.orgId, s.org.id))
      .orderBy(desc(bills.invoiceDate), desc(bills.id))
      .limit(200),
    db
      .select({ id: suppliers.id, name: suppliers.name, owed: sql<string>`sum(${bills.totalCents} - ${bills.paidCents})` })
      .from(bills)
      .innerJoin(suppliers, eq(suppliers.id, bills.supplierId))
      .where(and(eq(bills.orgId, s.org.id), eq(bills.status, "posted")))
      .groupBy(suppliers.id)
      .having(sql`sum(${bills.totalCents} - ${bills.paidCents}) > 0`),
  ]);
  const canPay = can(s.role, "books.post");

  return (
    <>
      <PageHeader title="Supplier invoices" subtitle="Stock received and what you owe for it." actions={<Link href="/stock/receive"><Button>Receive stock</Button></Link>} />
      {rows.length === 0 ? (
        <EmptyState title="No invoices yet" body="When stock arrives, record the supplier's invoice here. It adds the stock and tracks what you owe." action={<Link href="/stock/receive"><Button>Receive stock</Button></Link>} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_320px] items-start">
          <div className="card overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-ink-400">
                  <th className="px-4 py-3 font-semibold">Invoice</th>
                  <th className="px-4 py-3 font-semibold">Supplier</th>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold text-right">Total</th>
                  <th className="px-4 py-3 font-semibold text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ bill: b, supplier }) => {
                  const left = b.totalCents - b.paidCents;
                  const status = left <= 0 ? <Pill tone="good">Paid</Pill> : b.dueDate < today ? <Pill tone="bad">Overdue</Pill> : b.paidCents > 0 ? <Pill tone="warn">Part paid</Pill> : <Pill>Due {b.dueDate}</Pill>;
                  return (
                    <tr key={b.id} className="hairline-t">
                      <td className="px-4 py-3 font-medium">{b.supplierInvoiceNo}</td>
                      <td className="px-4 py-3 text-ink-600">{supplier}</td>
                      <td className="px-4 py-3 text-ink-600 tnum">{b.invoiceDate}</td>
                      <td className="px-4 py-3 text-right"><Money cents={b.totalCents} /></td>
                      <td className="px-4 py-3 text-right">{status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="grid gap-4">
            <div className="card p-5 grid gap-2">
              <h2 className="text-[13.5px] font-semibold">You owe</h2>
              {owed.length === 0 ? <p className="text-[13.5px] text-ink-400">All suppliers are paid.</p> : owed.map((o) => (
                <div key={o.id} className="flex justify-between text-[13.5px]"><span>{o.name}</span><Money cents={Number(o.owed)} /></div>
              ))}
            </div>
            {canPay && owed.length > 0 && <PayForm suppliers={owed.map((o) => ({ id: o.id, name: o.name, owedCents: Number(o.owed) }))} />}
          </div>
        </div>
      )}
    </>
  );
}
