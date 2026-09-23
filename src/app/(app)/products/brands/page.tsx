import { and, asc, count, eq } from "drizzle-orm";
import { db, brands, products } from "@/db";
import { requirePage } from "@/lib/auth";
import { EmptyState, PageHeader } from "@/components/ui";

export default async function BrandsPage() {
  const s = await requirePage("catalog.edit");
  const rows = await db
    .select({ id: brands.id, name: brands.name, n: count(products.id) })
    .from(brands)
    .leftJoin(products, and(eq(products.brandId, brands.id), eq(products.archived, false)))
    .where(and(eq(brands.orgId, s.org.id), eq(brands.archived, false)))
    .groupBy(brands.id)
    .orderBy(asc(brands.name));
  return (
    <>
      <PageHeader title="Brands" subtitle="Brands are added when you create a product." />
      {rows.length === 0 ? (
        <EmptyState title="No brands yet" body="Pick “+ New brand” on the product form and it will show up here." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((b) => (
            <div key={b.id} className="card p-4 flex justify-between items-baseline">
              <span className="font-semibold text-[14px]">{b.name}</span>
              <span className="text-[12.5px] text-ink-400 tnum">{b.n} product{b.n === 1 ? "" : "s"}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
