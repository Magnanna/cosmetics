import { and, count, eq, sql } from "drizzle-orm";
import { brands, categories, priceChangeRequests, products, variantBarcodes, variants, type Tx } from "@/db";
import { inStoreEan13 } from "./barcode";
import { ctx } from "./context";

/**
 * Editing the catalogue. Price rule: the owner's changes apply immediately;
 * staff changes to an existing price become a suggestion the owner approves
 * (new products take staff prices straight away — see receiving).
 */

export class CatalogError extends Error {}

async function productOf(tx: Tx, productId: number) {
  const [p] = await tx.select().from(products).where(and(eq(products.orgId, ctx().orgId), eq(products.id, productId))).limit(1);
  if (!p) throw new CatalogError("Product not found.");
  return p;
}

async function variantOf(tx: Tx, variantId: number) {
  const [v] = await tx.select().from(variants).where(and(eq(variants.orgId, ctx().orgId), eq(variants.id, variantId))).limit(1);
  if (!v) throw new CatalogError("Variant not found.");
  return v;
}

/** Next free in-store EAN-13 (prefix 2x) for items without a manufacturer barcode. */
export async function nextInStoreBarcode(tx: Tx): Promise<string> {
  const { orgId } = ctx();
  const [{ n }] = await tx.select({ n: count() }).from(variantBarcodes).where(and(eq(variantBarcodes.orgId, orgId), eq(variantBarcodes.source, "generated")));
  for (let seq = n + 1; ; seq++) {
    const code = inStoreEan13(orgId, seq);
    const [clash] = await tx.select({ id: variantBarcodes.id }).from(variantBarcodes).where(and(eq(variantBarcodes.orgId, orgId), eq(variantBarcodes.code, code))).limit(1);
    if (!clash) return code;
  }
}

export async function updateProduct(tx: Tx, p: { productId: number; name: string; brandName: string | null; categoryId: number | null; option1Name: string | null; option2Name: string | null; archived: boolean }) {
  const { orgId } = ctx();
  const before = await productOf(tx, p.productId);
  if (p.name.trim().length < 2) throw new CatalogError("Give the product a name.");
  if (p.option2Name && !p.option1Name) throw new CatalogError("Fill in the first option before the second.");
  if (p.categoryId) {
    const [c] = await tx.select({ id: categories.id }).from(categories).where(and(eq(categories.orgId, orgId), eq(categories.id, p.categoryId))).limit(1);
    if (!c) throw new CatalogError("That category no longer exists.");
  }
  let brandId: number | null = null;
  if (p.brandName?.trim()) {
    const [b] = await tx
      .insert(brands)
      .values({ orgId, name: p.brandName.trim() })
      .onConflictDoUpdate({ target: [brands.orgId, brands.name], set: { archived: false } })
      .returning({ id: brands.id });
    brandId = b.id;
  }
  const after = { name: p.name.trim(), brandId, categoryId: p.categoryId, option1Name: p.option1Name?.trim() || null, option2Name: p.option2Name?.trim() || null, archived: p.archived, updatedAt: new Date() };
  await tx.update(products).set(after).where(eq(products.id, before.id));
  return { before, after };
}

export async function updateVariant(tx: Tx, p: { variantId: number; option1Value: string | null; option2Value: string | null; reorderLevel: number; swatchHex: string | null; archived: boolean }) {
  const before = await variantOf(tx, p.variantId);
  if (!Number.isInteger(p.reorderLevel) || p.reorderLevel < 0) throw new CatalogError("Reorder level must be a whole number.");
  if (p.swatchHex && !/^#[0-9a-fA-F]{6}$/.test(p.swatchHex)) throw new CatalogError("Pick a colour for the swatch.");
  const o1 = p.option1Value?.trim() || null;
  const o2 = p.option2Value?.trim() || null;
  const [clash] = await tx
    .select({ id: variants.id })
    .from(variants)
    .where(and(eq(variants.productId, before.productId), sql`${variants.id} <> ${before.id}`, sql`coalesce(${variants.option1Value},'') = ${o1 ?? ""}`, sql`coalesce(${variants.option2Value},'') = ${o2 ?? ""}`))
    .limit(1);
  if (clash) throw new CatalogError("Another variant of this product already has those options.");
  const after = { option1Value: o1, option2Value: o2, reorderLevel: p.reorderLevel, swatchHex: p.swatchHex, archived: p.archived };
  await tx.update(variants).set(after).where(eq(variants.id, before.id));
  return { before, after };
}

export async function addVariant(tx: Tx, p: { productId: number; option1Value: string | null; option2Value: string | null; retailPriceCents: number; wholesalePriceCents: number; barcode: string | null }) {
  const { orgId } = ctx();
  const prod = await productOf(tx, p.productId);
  if (!prod.option1Name) throw new CatalogError("Name the option first (e.g. Shade) in the product details, then add variants.");
  if (!p.option1Value?.trim()) throw new CatalogError(`Enter the ${prod.option1Name.toLowerCase()}.`);
  if (p.retailPriceCents <= 0) throw new CatalogError("Set the retail price.");
  const [v] = await tx
    .insert(variants)
    .values({ orgId, productId: prod.id, option1Value: p.option1Value.trim(), option2Value: p.option2Value?.trim() || null, retailPriceCents: p.retailPriceCents, wholesalePriceCents: p.wholesalePriceCents })
    .returning({ id: variants.id });
  await addBarcode(tx, { variantId: v.id, code: p.barcode });
  return v.id;
}

/** Price change. Owner: applied. Staff: saved as a suggestion for the owner. */
export async function changePrices(tx: Tx, p: { variantId: number; retailPriceCents: number; wholesalePriceCents: number; reason?: string | null }): Promise<"applied" | "requested" | "unchanged"> {
  const { orgId, role, memberId } = ctx();
  const v = await variantOf(tx, p.variantId);
  for (const c of [p.retailPriceCents, p.wholesalePriceCents]) if (!Number.isInteger(c) || c < 0) throw new CatalogError("Prices must be amounts of zero or more.");
  if (p.retailPriceCents === 0) throw new CatalogError("Retail price can't be zero.");
  const changes = [
    { field: "retail" as const, oldCents: v.retailPriceCents, newCents: p.retailPriceCents },
    { field: "wholesale" as const, oldCents: v.wholesalePriceCents, newCents: p.wholesalePriceCents },
  ].filter((c) => c.oldCents !== c.newCents);
  if (changes.length === 0) return "unchanged";
  if (role === "owner") {
    await tx.update(variants).set({ retailPriceCents: p.retailPriceCents, wholesalePriceCents: p.wholesalePriceCents }).where(eq(variants.id, v.id));
    return "applied";
  }
  if (!memberId) throw new CatalogError("Sign in first.");
  // One open suggestion per variant and field: a newer suggestion replaces the older one.
  for (const c of changes) {
    await tx.delete(priceChangeRequests).where(and(eq(priceChangeRequests.orgId, orgId), eq(priceChangeRequests.variantId, v.id), eq(priceChangeRequests.field, c.field), eq(priceChangeRequests.status, "pending")));
    await tx.insert(priceChangeRequests).values({ orgId, variantId: v.id, field: c.field, oldCents: c.oldCents, newCents: c.newCents, reason: p.reason?.trim() || null, requestedBy: memberId });
  }
  return "requested";
}

export async function decidePriceRequest(tx: Tx, requestId: number, approve: boolean) {
  const { orgId, role, memberId } = ctx();
  if (role !== "owner") throw new CatalogError("Only the owner can approve prices.");
  const [r] = await tx.select().from(priceChangeRequests).where(and(eq(priceChangeRequests.orgId, orgId), eq(priceChangeRequests.id, requestId))).for("update");
  if (!r || r.status !== "pending") throw new CatalogError("That suggestion was already handled.");
  if (approve) {
    await tx.update(variants).set(r.field === "retail" ? { retailPriceCents: r.newCents } : { wholesalePriceCents: r.newCents }).where(eq(variants.id, r.variantId));
  }
  await tx.update(priceChangeRequests).set({ status: approve ? "approved" : "rejected", decidedBy: memberId, decidedAt: new Date() }).where(eq(priceChangeRequests.id, r.id));
  return r;
}

/** Adds a manufacturer barcode, or generates an in-store one when `code` is null. */
export async function addBarcode(tx: Tx, p: { variantId: number; code: string | null }): Promise<string> {
  const { orgId } = ctx();
  const v = await variantOf(tx, p.variantId);
  const code = p.code?.trim() || (await nextInStoreBarcode(tx));
  if (!/^\d{6,14}$/.test(code)) throw new CatalogError("A barcode is 6 to 14 digits.");
  const [taken] = await tx.select({ variantId: variantBarcodes.variantId }).from(variantBarcodes).where(and(eq(variantBarcodes.orgId, orgId), eq(variantBarcodes.code, code))).limit(1);
  if (taken) throw new CatalogError(taken.variantId === v.id ? "That barcode is already on this item." : "That barcode is already on another product.");
  await tx.insert(variantBarcodes).values({ orgId, variantId: v.id, code, source: p.code?.trim() ? "manufacturer" : "generated" });
  return code;
}

export async function removeBarcode(tx: Tx, barcodeId: number) {
  const { orgId } = ctx();
  const [b] = await tx.select().from(variantBarcodes).where(and(eq(variantBarcodes.orgId, orgId), eq(variantBarcodes.id, barcodeId))).limit(1);
  if (!b) throw new CatalogError("Barcode not found.");
  await tx.delete(variantBarcodes).where(eq(variantBarcodes.id, b.id));
  return b;
}
