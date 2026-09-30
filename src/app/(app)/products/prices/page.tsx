import { and, desc, eq } from "drizzle-orm";
import { db, members, priceChangeRequests, products, variants } from "@/db";
import { requirePage } from "@/lib/auth";
import { EmptyState, Money, PageHeader } from "@/components/ui";
import { DecideButtons } from "./decide";

export const dynamic = "force-dynamic";

export default async function PriceRequestsPage() {
  const s = await requirePage("catalog.set_prices");
  const rows = await db
    .select({ r: priceChangeRequests, product: products.name, productId: products.id, o1: variants.option1Value, o2: variants.option2Value, who: members.name })
    .from(priceChangeRequests)
    .innerJoin(variants, eq(variants.id, priceChangeRequests.variantId))
    .innerJoin(products, eq(products.id, variants.productId))
    .leftJoin(members, eq(members.id, priceChangeRequests.requestedBy))
    .where(and(eq(priceChangeRequests.orgId, s.org.id), eq(priceChangeRequests.status, "pending")))
    .orderBy(desc(priceChangeRequests.createdAt));
  return (
    <>
      <PageHeader title="Price suggestions" subtitle="Staff suggested these price changes. Approving applies them on the till straight away." />
      {rows.length === 0 ? <EmptyState title="Nothing to review" body="When staff change a price on an existing product, it waits here for you." /> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-[13.5px]"><tbody>
            {rows.map(({ r, product, productId, o1, o2, who }) => (
              <tr key={r.id} className="hairline-t">
                <td className="px-4 py-3"><a href={`/products/${productId}`} className="font-medium hover:underline">{[product, o1, o2].filter(Boolean).join(" · ")}</a><div className="text-[12px] text-ink-400">{r.field === "retail" ? "Retail" : "Wholesale"} price · {who || "Staff"}{r.reason ? ` · “${r.reason}”` : ""}</div></td>
                <td className="px-4 py-3 text-right whitespace-nowrap"><Money cents={r.oldCents} className="text-ink-400 line-through mr-2" /><Money cents={r.newCents} className="font-semibold" /></td>
                <td className="px-4 py-3 text-right"><DecideButtons id={r.id} /></td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
    </>
  );
}
