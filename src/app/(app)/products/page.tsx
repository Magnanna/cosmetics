import Link from "next/link";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, brands, categories, products, stockLots, variants } from "@/db";
import { requirePage, inOrg } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { Button, EmptyState, Money, PageHeader, Pill } from "@/components/ui";

export default async function ProductsPage() {
  const s = await requirePage("catalog.view");
  const rows = await inOrg(s, () =>
    db
      .select({
        id: products.id,
        name: products.name,
        brand: brands.name,
        category: categories.name,
        variantCount: sql<number>`count(distinct ${variants.id})::int`,
        minPrice: sql<number>`min(${variants.retailPriceCents})::bigint`,
        maxPrice: sql<number>`max(${variants.retailPriceCents})::bigint`,
        unpriced: sql<number>`count(distinct ${variants.id}) filter (where ${variants.retailPriceCents} = 0)::int`,
        onHand: sql<number>`coalesce((select sum(${stockLots.remainingQty}) from ${stockLots} where ${stockLots.variantId} in (select v2.id from variants v2 where v2.product_id = ${products.id})), 0)::int`,
      })
      .from(products)
      .leftJoin(brands, eq(products.brandId, brands.id))
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .leftJoin(variants, and(eq(variants.productId, products.id), eq(variants.archived, false)))
      .where(and(eq(products.orgId, s.org.id), eq(products.archived, false)))
      .groupBy(products.id, brands.name, categories.name)
      .orderBy(asc(products.name))
  );

  const canEdit = can(s.role, "catalog.edit");

  return (
    <>
      <PageHeader
        title="Catalogue"
        subtitle={`${rows.length} product${rows.length === 1 ? "" : "s"}`}
        actions={canEdit ? <Link href="/products/new"><Button>New product</Button></Link> : undefined}
      />
      {rows.length === 0 ? (
        <EmptyState
          title="No products yet"
          body="Add your first product with its shades or sizes, barcode and prices."
          action={canEdit ? <Link href="/products/new"><Button>New product</Button></Link> : undefined}
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-ink-400">
                <th className="px-4 py-3 font-semibold">Product</th>
                <th className="px-4 py-3 font-semibold">Brand</th>
                <th className="px-4 py-3 font-semibold">Category</th>
                <th className="px-4 py-3 font-semibold text-right">Variants</th>
                <th className="px-4 py-3 font-semibold text-right">Retail KES</th>
                <th className="px-4 py-3 font-semibold text-right">In stock</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hairline-t">
                  <td className="px-4 py-3 font-medium">
                    {r.name} {r.unpriced > 0 && <Pill tone="warn">Price pending</Pill>}
                  </td>
                  <td className="px-4 py-3 text-ink-600">{r.brand ?? "—"}</td>
                  <td className="px-4 py-3 text-ink-600">{r.category ?? "—"}</td>
                  <td className="px-4 py-3 text-right tnum">{r.variantCount}</td>
                  <td className="px-4 py-3 text-right">
                    <Money cents={Number(r.minPrice)} />
                    {Number(r.maxPrice) !== Number(r.minPrice) && <> – <Money cents={Number(r.maxPrice)} /></>}
                  </td>
                  <td className={`px-4 py-3 text-right tnum ${r.onHand < 0 ? "text-bad" : ""}`}>{r.onHand}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
