import Link from "next/link";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, receivings, suppliers } from "@/db";
import { requirePage } from "@/lib/auth";
import { nairobiDate } from "@/lib/time";
import { EmptyState, PageHeader } from "@/components/ui";
import { StartDelivery } from "./start-delivery";

export const dynamic = "force-dynamic";

export default async function ReceivePage() {
  const s = await requirePage("stock.receive");
  const [supplierRows, drafts] = await Promise.all([
    db.select({ id: suppliers.id, name: suppliers.name, termsDays: suppliers.termsDays }).from(suppliers).where(and(eq(suppliers.orgId, s.org.id), eq(suppliers.archived, false))).orderBy(asc(suppliers.name)),
    db
      .select({
        r: receivings,
        supplier: suppliers.name,
        units: sql<number>`coalesce((select sum(rl.qty)::int from receiving_lines rl where rl.receiving_id = "receivings"."id"), 0)`,
      })
      .from(receivings)
      .innerJoin(suppliers, eq(suppliers.id, receivings.supplierId))
      .where(and(eq(receivings.orgId, s.org.id), eq(receivings.status, "draft")))
      .orderBy(desc(receivings.createdAt)),
  ]);

  if (supplierRows.length === 0) {
    return (
      <>
        <PageHeader title="Receive stock" />
        <EmptyState title="Add a supplier first" body="Every delivery comes with a supplier's invoice." action={<Link href="/suppliers" className="text-brand-700 underline">Go to suppliers</Link>} />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Receive stock" subtitle="Scan the delivery. New products are named from their barcode — you just set the prices." />
      <div className="grid gap-5 lg:grid-cols-[1fr_360px] items-start">
        <div className="card overflow-hidden">
          <div className="px-4 pt-4 pb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Deliveries in progress</div>
          {drafts.length === 0 ? (
            <p className="px-4 pb-5 text-[13.5px] text-ink-400">None. Start one when stock arrives.</p>
          ) : (
            <ul>
              {drafts.map(({ r, supplier, units }) => (
                <li key={r.id} className="hairline-t">
                  <Link href={`/stock/receive/${r.id}`} className="flex justify-between gap-3 px-4 py-3 hover:bg-ink-50">
                    <span><span className="font-medium">{supplier}</span><span className="text-ink-400"> · {r.supplierInvoiceNo}</span></span>
                    <span className="text-[13px] text-ink-600 tnum">{units} units scanned</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <StartDelivery suppliers={supplierRows} today={nairobiDate()} />
      </div>
    </>
  );
}
