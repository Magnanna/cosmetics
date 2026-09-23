import { and, asc, eq } from "drizzle-orm";
import { db, suppliers } from "@/db";
import { requirePage } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { SupplierForm } from "./supplier-form";

export default async function SuppliersPage() {
  const s = await requirePage("suppliers.edit");
  const rows = await db.select().from(suppliers).where(and(eq(suppliers.orgId, s.org.id), eq(suppliers.archived, false))).orderBy(asc(suppliers.name));
  return (
    <>
      <PageHeader title="Suppliers" subtitle="Who you buy stock from. Balances appear once you record their invoices." />
      <div className="grid gap-5 lg:grid-cols-[1fr_340px] items-start">
        <div className="card overflow-x-auto">
          {rows.length === 0 ? (
            <p className="p-6 text-[13.5px] text-ink-400">No suppliers yet. Add your first one on the right.</p>
          ) : (
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-ink-400">
                  <th className="px-4 py-3 font-semibold">Supplier</th>
                  <th className="px-4 py-3 font-semibold">Phone</th>
                  <th className="px-4 py-3 font-semibold">KRA PIN</th>
                  <th className="px-4 py-3 font-semibold text-right">Terms</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="hairline-t">
                    <td className="px-4 py-3"><div className="font-medium">{r.name}</div>{r.paymentDetails && <div className="text-[12px] text-ink-400">{r.paymentDetails}</div>}</td>
                    <td className="px-4 py-3 text-ink-600 tnum">{r.phone ?? "—"}</td>
                    <td className="px-4 py-3 text-ink-600">{r.kraPin ?? "—"}</td>
                    <td className="px-4 py-3 text-right tnum">{r.termsDays ? `${r.termsDays} days` : "On delivery"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <SupplierForm />
      </div>
    </>
  );
}
