import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db, categories, products, receivingLines, receivings, suppliers, variantBarcodes, variants } from "@/db";
import { requirePage } from "@/lib/auth";
import { imagesEnabled } from "@/lib/images";
import { variantPicklist } from "@/lib/picklist";
import { PageHeader } from "@/components/ui";
import { DeliveryScreen, type DeliveryLine } from "./delivery-screen";

export const dynamic = "force-dynamic";

export default async function DeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePage("stock.receive");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const [row] = await db
    .select({ r: receivings, supplier: suppliers.name })
    .from(receivings)
    .innerJoin(suppliers, eq(suppliers.id, receivings.supplierId))
    .where(and(eq(receivings.orgId, s.org.id), eq(receivings.id, id)))
    .limit(1);
  if (!row) notFound();
  if (row.r.status !== "draft") redirect("/stock/bills");

  const [lineRows, codes, picklist, cats, productRows] = await Promise.all([
    db
      .select({
        variantId: receivingLines.variantId,
        qty: receivingLines.qty,
        unitRateCents: receivingLines.unitRateCents,
        productId: products.id,
        productName: products.name,
        imageUrl: products.imageUrl,
        o1: variants.option1Value,
        o2: variants.option2Value,
        retail: variants.retailPriceCents,
        wholesale: variants.wholesalePriceCents,
      })
      .from(receivingLines)
      .innerJoin(variants, eq(variants.id, receivingLines.variantId))
      .innerJoin(products, eq(products.id, variants.productId))
      .where(eq(receivingLines.receivingId, id))
      .orderBy(asc(receivingLines.id)),
    db.select({ variantId: variantBarcodes.variantId, code: variantBarcodes.code }).from(variantBarcodes).where(eq(variantBarcodes.orgId, s.org.id)),
    variantPicklist(s.org.id),
    db.select().from(categories).where(and(eq(categories.orgId, s.org.id), eq(categories.archived, false))).orderBy(asc(categories.sortOrder)),
    db.select({ id: products.id, name: products.name, option1Name: products.option1Name }).from(products).where(and(eq(products.orgId, s.org.id), eq(products.archived, false))).orderBy(asc(products.name)),
  ]);

  const codeOf = new Map<number, string>();
  for (const c of codes) if (!codeOf.has(c.variantId)) codeOf.set(c.variantId, c.code);
  const parents = cats.filter((c) => c.parentId === null);
  const categoryOptions = parents.flatMap((p) => [{ id: p.id, label: p.name }, ...cats.filter((c) => c.parentId === p.id).map((c) => ({ id: c.id, label: `${p.name} › ${c.name}` }))]);

  const lines: DeliveryLine[] = lineRows.map((l) => ({
    variantId: l.variantId,
    productId: l.productId,
    name: [l.productName, l.o1, l.o2].filter(Boolean).join(" · "),
    imageUrl: l.imageUrl,
    barcode: codeOf.get(l.variantId) ?? null,
    qty: l.qty,
    unitRateCents: l.unitRateCents,
    retailCents: l.retail,
    wholesaleCents: l.wholesale,
  }));

  return (
    <>
      <PageHeader title={`Receiving from ${row.supplier}`} subtitle={`Invoice ${row.r.supplierInvoiceNo} · ${row.r.invoiceDate} · rates ${row.r.ratesIncludeVat ? "include" : "exclude"} VAT`} />
      <DeliveryScreen
        receivingId={id}
        ratesIncludeVat={row.r.ratesIncludeVat}
        initialLines={lines}
        picklist={picklist}
        categories={categoryOptions}
        products={productRows}
        photosEnabled={imagesEnabled()}
      />
    </>
  );
}
