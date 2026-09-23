import { and, asc, eq } from "drizzle-orm";
import { db, brands, categories } from "@/db";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/ui";
import { ProductForm } from "./product-form";

export default async function NewProductPage() {
  const s = await requirePage("catalog.edit");
  const [brandRows, categoryRows] = await Promise.all([
    db.select({ id: brands.id, name: brands.name }).from(brands).where(and(eq(brands.orgId, s.org.id), eq(brands.archived, false))).orderBy(asc(brands.name)),
    db.select().from(categories).where(and(eq(categories.orgId, s.org.id), eq(categories.archived, false))).orderBy(asc(categories.sortOrder)),
  ]);
  const parents = categoryRows.filter((c) => c.parentId === null);
  const categoryOptions = parents.flatMap((p) => [
    { id: p.id, label: p.name },
    ...categoryRows.filter((c) => c.parentId === p.id).map((c) => ({ id: c.id, label: `${p.name} › ${c.name}` })),
  ]);

  return (
    <>
      <PageHeader
        title="New product"
        subtitle={can(s.role, "catalog.set_prices") ? "Prices apply immediately." : "Your prices go to the owner for approval."}
      />
      <ProductForm brands={brandRows} categories={categoryOptions} canStock={can(s.role, "stock.receive")} />
    </>
  );
}
