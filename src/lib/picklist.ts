import { and, asc, eq, sql } from "drizzle-orm";
import { db, products, stockLots, variantBarcodes, variants } from "@/db";

export interface PickVariant {
  id: number;
  label: string;
  barcodes: string[];
  onHand: number;
}

/** Every sellable variant with its barcodes and on-hand quantity, for search-or-scan pickers. */
export async function variantPicklist(orgId: number): Promise<PickVariant[]> {
  const [rows, codes, stock] = await Promise.all([
    db
      .select({ id: variants.id, product: products.name, o1: variants.option1Value, o2: variants.option2Value })
      .from(variants)
      .innerJoin(products, eq(products.id, variants.productId))
      .where(and(eq(variants.orgId, orgId), eq(variants.archived, false), eq(products.archived, false)))
      .orderBy(asc(products.name), asc(variants.id)),
    db.select({ variantId: variantBarcodes.variantId, code: variantBarcodes.code }).from(variantBarcodes).where(eq(variantBarcodes.orgId, orgId)),
    db.select({ variantId: stockLots.variantId, qty: sql<string>`sum(${stockLots.remainingQty})` }).from(stockLots).where(eq(stockLots.orgId, orgId)).groupBy(stockLots.variantId),
  ]);
  const barcodes = new Map<number, string[]>();
  for (const c of codes) barcodes.set(c.variantId, [...(barcodes.get(c.variantId) ?? []), c.code]);
  const onHand = new Map(stock.map((s) => [s.variantId, Number(s.qty)]));
  return rows.map((r) => ({ id: r.id, label: [r.product, r.o1, r.o2].filter(Boolean).join(" · "), barcodes: barcodes.get(r.id) ?? [], onHand: onHand.get(r.id) ?? 0 }));
}
