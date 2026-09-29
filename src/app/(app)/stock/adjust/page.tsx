import { desc, eq } from "drizzle-orm";
import { db, members, products, stockAdjustments, variants } from "@/db";
import { requirePage } from "@/lib/auth";
import { variantPicklist } from "@/lib/picklist";
import { ADJUSTMENT_REASONS, type AdjustmentReason } from "@/lib/stock-postings";
import { Money, PageHeader, Pill } from "@/components/ui";
import { AdjustForm } from "./adjust-form";

export const dynamic = "force-dynamic";

export default async function AdjustPage() {
  const s = await requirePage("stock.receive");
  const [picklist, recent] = await Promise.all([
    variantPicklist(s.org.id),
    db
      .select({ a: stockAdjustments, product: products.name, o1: variants.option1Value, o2: variants.option2Value, who: members.name })
      .from(stockAdjustments)
      .innerJoin(variants, eq(variants.id, stockAdjustments.variantId))
      .innerJoin(products, eq(products.id, variants.productId))
      .leftJoin(members, eq(members.id, stockAdjustments.memberId))
      .where(eq(stockAdjustments.orgId, s.org.id))
      .orderBy(desc(stockAdjustments.createdAt))
      .limit(50),
  ]);

  return (
    <>
      <PageHeader title="Adjust stock" subtitle="Record damaged, lost or found items. Adjustments over KES 1,000 need the owner." />
      <div className="grid gap-5 lg:grid-cols-[360px_1fr] items-start">
        <AdjustForm variants={picklist} />
        <div className="card overflow-x-auto">
          <div className="px-4 pt-4 pb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Recent adjustments</div>
          {recent.length === 0 ? (
            <p className="px-4 pb-5 text-[13.5px] text-ink-400">None yet.</p>
          ) : (
            <table className="w-full text-[13.5px]">
              <tbody>
                {recent.map(({ a, product, o1, o2, who }) => (
                  <tr key={a.id} className="hairline-t">
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{[product, o1, o2].filter(Boolean).join(" · ")}</div>
                      <div className="text-[12px] text-ink-400">{who || "Staff"} · {a.createdAt.toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" })}{a.note ? ` · ${a.note}` : ""}</div>
                    </td>
                    <td className="px-4 py-2.5"><Pill tone={a.qtyDelta < 0 ? "bad" : "good"}>{ADJUSTMENT_REASONS[a.reason as AdjustmentReason] ?? a.reason}</Pill></td>
                    <td className={`px-4 py-2.5 text-right tnum ${a.qtyDelta < 0 ? "text-bad" : "text-good"}`}>{a.qtyDelta > 0 ? `+${a.qtyDelta}` : a.qtyDelta}</td>
                    <td className="px-4 py-2.5 text-right"><Money cents={a.qtyDelta < 0 ? -a.costCents : a.costCents} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
