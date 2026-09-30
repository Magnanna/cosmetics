import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, brands, categories, priceChangeRequests, products, stockLots, variantBarcodes, variants } from "@/db";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/ui";
import { ProductEditor, type EditableVariant } from "./editor";

export const dynamic = "force-dynamic";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePage("catalog.edit");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const [p] = await db.select({ p: products, brand: brands.name }).from(products).leftJoin(brands, eq(brands.id, products.brandId)).where(and(eq(products.orgId, s.org.id), eq(products.id, id))).limit(1);
  if (!p) notFound();
  const vs = await db.select().from(variants).where(eq(variants.productId, id)).orderBy(asc(variants.id));
  const ids = vs.map((v) => v.id);
  const [codes, stock, pending, cats] = await Promise.all([
    ids.length ? db.select().from(variantBarcodes).where(inArray(variantBarcodes.variantId, ids)) : [],
    ids.length ? db.select({ variantId: stockLots.variantId, qty: sql<string>`sum(${stockLots.remainingQty})`, value: sql<string>`sum(${stockLots.remainingCostCents})` }).from(stockLots).where(inArray(stockLots.variantId, ids)).groupBy(stockLots.variantId) : [],
    ids.length ? db.select().from(priceChangeRequests).where(and(inArray(priceChangeRequests.variantId, ids), eq(priceChangeRequests.status, "pending"))) : [],
    db.select().from(categories).where(and(eq(categories.orgId, s.org.id), eq(categories.archived, false))).orderBy(asc(categories.sortOrder)),
  ]);
  const parents = cats.filter((c) => c.parentId === null);
  const categoryOptions = parents.flatMap((c) => [{ id: c.id, label: c.name }, ...cats.filter((x) => x.parentId === c.id).map((x) => ({ id: x.id, label: `${c.name} › ${x.name}` }))]);
  const showCosts = can(s.role, "catalog.view_costs");
  const editable: EditableVariant[] = vs.map((v) => {
    const st = stock.find((x) => x.variantId === v.id);
    const qty = Number(st?.qty ?? 0);
    return {
      id: v.id,
      option1Value: v.option1Value,
      option2Value: v.option2Value,
      retailCents: v.retailPriceCents,
      wholesaleCents: v.wholesalePriceCents,
      reorderLevel: v.reorderLevel,
      swatchHex: v.swatchHex,
      archived: v.archived,
      onHand: qty,
      avgCostCents: showCosts && qty > 0 ? Math.round(Number(st!.value) / qty) : null,
      barcodes: codes.filter((c) => c.variantId === v.id).map((c) => ({ id: c.id, code: c.code, source: c.source })),
      pending: pending.filter((r) => r.variantId === v.id).map((r) => ({ field: r.field, newCents: r.newCents })),
    };
  });
  return (
    <>
      <PageHeader title={p.p.name} subtitle={`${p.brand ?? "No brand"}${p.p.archived ? " · archived" : ""}`} actions={<Link href="/products" className="text-[13px] text-ink-600 underline">All products</Link>} />
      <ProductEditor
        product={{ id: p.p.id, name: p.p.name, brandName: p.brand, categoryId: p.p.categoryId, option1Name: p.p.option1Name, option2Name: p.p.option2Name, archived: p.p.archived, imageUrl: p.p.imageUrl }}
        variants={editable}
        categories={categoryOptions}
        isOwner={s.role === "owner"}
      />
    </>
  );
}
