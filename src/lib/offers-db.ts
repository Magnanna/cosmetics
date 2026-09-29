import { and, eq, gt, inArray } from "drizzle-orm";
import { categories, offerTargets, offers, products, variants, type DbOrTx } from "@/db";
import type { OfferDef, PricedItem } from "./offers";

/** Offers that haven't ended yet (the till filters to what's live right now). */
export async function loadOffers(db: DbOrTx, orgId: number, now = new Date()): Promise<OfferDef[]> {
  const rows = await db.select().from(offers).where(and(eq(offers.orgId, orgId), eq(offers.active, true), gt(offers.endsAt, now)));
  if (rows.length === 0) return [];
  const t = await db.select().from(offerTargets).where(inArray(offerTargets.offerId, rows.map((r) => r.id)));
  return rows.map((o) => ({
    id: o.id,
    title: o.title,
    type: o.type as OfferDef["type"],
    value: o.value,
    minSpendCents: o.minSpendCents,
    audience: o.audience as OfferDef["audience"],
    startsAt: o.startsAt.toISOString(),
    endsAt: o.endsAt.toISOString(),
    active: o.active,
    targets: t.filter((x) => x.offerId === o.id).map((x) => ({ kind: x.kind as OfferDef["targets"][number]["kind"], targetId: x.targetId })),
  }));
}

/** What the offers engine needs to know about each variant. */
export async function itemFacts(db: DbOrTx, orgId: number, variantIds: number[]): Promise<Map<number, Omit<PricedItem, "unitCents" | "qty">>> {
  if (variantIds.length === 0) return new Map();
  const rows = await db
    .select({ variantId: variants.id, productId: products.id, brandId: products.brandId, categoryId: products.categoryId })
    .from(variants)
    .innerJoin(products, eq(products.id, variants.productId))
    .where(and(eq(variants.orgId, orgId), inArray(variants.id, variantIds)));
  const cats = await db.select({ id: categories.id, parentId: categories.parentId }).from(categories).where(eq(categories.orgId, orgId));
  const parentOf = new Map(cats.map((c) => [c.id, c.parentId]));
  return new Map(
    rows.map((r) => [
      r.variantId,
      {
        variantId: r.variantId,
        productId: r.productId,
        brandId: r.brandId,
        categoryIds: r.categoryId ? [r.categoryId, ...(parentOf.get(r.categoryId) ? [parentOf.get(r.categoryId)!] : [])] : [],
      },
    ])
  );
}
