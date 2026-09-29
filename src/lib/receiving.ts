import { and, asc, eq, sql } from "drizzle-orm";
import { brands, products, receivingLines, receivings, suppliers, variantBarcodes, variants, type DbOrTx, type Tx } from "@/db";
import { inStoreEan13 } from "./barcode";
import { ctx } from "./context";
import { postBill } from "./purchasing";

/**
 * Scan-to-receive. A delivery is scanned into a draft (server-side, so the
 * till PC and a phone can both work on it); each line needs the unit rate
 * from the supplier invoice; posting turns it into a normal supplier bill.
 */

export class ReceivingError extends Error {}

async function loadDraft(tx: DbOrTx, id: number) {
  const [r] = await tx.select().from(receivings).where(and(eq(receivings.orgId, ctx().orgId), eq(receivings.id, id))).limit(1);
  if (!r) throw new ReceivingError("Delivery not found.");
  if (r.status !== "draft") throw new ReceivingError("This delivery was already saved.");
  return r;
}

export async function startReceiving(
  tx: Tx,
  p: { supplierId: number; supplierInvoiceNo: string; invoiceDate: string; dueDate: string; ratesIncludeVat: boolean }
): Promise<number> {
  const { orgId, memberId } = ctx();
  if (!memberId) throw new ReceivingError("Sign in first.");
  const [s] = await tx.select({ id: suppliers.id }).from(suppliers).where(and(eq(suppliers.orgId, orgId), eq(suppliers.id, p.supplierId))).limit(1);
  if (!s) throw new ReceivingError("Pick a supplier.");
  if (!p.supplierInvoiceNo.trim()) throw new ReceivingError("Type the invoice number from the supplier's paper.");
  const [r] = await tx.insert(receivings).values({ orgId, ...p, supplierInvoiceNo: p.supplierInvoiceNo.trim(), createdBy: memberId }).returning({ id: receivings.id });
  return r.id;
}

export async function variantByBarcode(db: DbOrTx, code: string): Promise<number | null> {
  const [row] = await db
    .select({ variantId: variantBarcodes.variantId })
    .from(variantBarcodes)
    .where(and(eq(variantBarcodes.orgId, ctx().orgId), eq(variantBarcodes.code, code.trim())))
    .limit(1);
  return row?.variantId ?? null;
}

/** Adds `qty` of a variant to the delivery (scans add 1 each). */
export async function addToReceiving(tx: Tx, receivingId: number, variantId: number, qty = 1): Promise<number> {
  const { orgId } = ctx();
  await loadDraft(tx, receivingId);
  const [v] = await tx.select({ id: variants.id }).from(variants).where(and(eq(variants.orgId, orgId), eq(variants.id, variantId))).limit(1);
  if (!v) throw new ReceivingError("Unknown product.");
  const [line] = await tx
    .insert(receivingLines)
    .values({ orgId, receivingId, variantId, qty })
    .onConflictDoUpdate({ target: [receivingLines.receivingId, receivingLines.variantId], set: { qty: sql`${receivingLines.qty} + ${qty}` } })
    .returning({ qty: receivingLines.qty });
  return line.qty;
}

export async function updateReceivingLine(tx: Tx, receivingId: number, variantId: number, patch: { qty?: number; unitRateCents?: number | null }) {
  await loadDraft(tx, receivingId);
  if (patch.qty !== undefined && (!Number.isInteger(patch.qty) || patch.qty < 0)) throw new ReceivingError("Quantity must be a whole number.");
  if (patch.unitRateCents != null && (!Number.isInteger(patch.unitRateCents) || patch.unitRateCents < 0)) throw new ReceivingError("Enter a valid cost.");
  const where = and(eq(receivingLines.orgId, ctx().orgId), eq(receivingLines.receivingId, receivingId), eq(receivingLines.variantId, variantId));
  if (patch.qty === 0) {
    await tx.delete(receivingLines).where(where);
    return;
  }
  await tx.update(receivingLines).set(patch).where(where);
}

export async function discardReceiving(tx: Tx, receivingId: number) {
  await loadDraft(tx, receivingId);
  await tx.update(receivings).set({ status: "discarded" }).where(eq(receivings.id, receivingId));
}

/** Turns the scanned delivery into a supplier bill: stock in, Accounts Payable up. */
export async function postReceiving(tx: Tx, receivingId: number): Promise<{ billId: number; totalCents: number }> {
  const r = await loadDraft(tx, receivingId);
  await tx.select({ id: receivings.id }).from(receivings).where(eq(receivings.id, r.id)).for("update");
  const lines = await tx.select().from(receivingLines).where(eq(receivingLines.receivingId, r.id)).orderBy(asc(receivingLines.id));
  if (lines.length === 0) throw new ReceivingError("Scan at least one item.");
  const missing = lines.filter((l) => l.unitRateCents === null).length;
  if (missing) throw new ReceivingError(`${missing} item${missing === 1 ? " has" : "s have"} no cost yet. Type the rate from the supplier invoice.`);
  const bill = await postBill(tx, {
    supplierId: r.supplierId,
    supplierInvoiceNo: r.supplierInvoiceNo,
    invoiceDate: r.invoiceDate,
    dueDate: r.dueDate,
    ratesIncludeVat: r.ratesIncludeVat,
    vatBp: 1600,
    lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty, unitsPerUom: 1, rateCents: l.unitRateCents! })),
  });
  await tx.update(receivings).set({ status: "posted", billId: bill.billId }).where(eq(receivings.id, r.id));
  return bill;
}

export interface NewItemInput {
  barcode: string | null;
  name: string;
  brandName: string | null;
  categoryId: number | null;
  /** Add as another shade/size of this product instead of a new product. */
  attachToProductId: number | null;
  optionValue: string | null;
  swatchHex: string | null;
  retailPriceCents: number;
  wholesalePriceCents: number;
}

/**
 * Creates a product (or a new shade of an existing one) from a scan, with its
 * barcode — or a generated in-store barcode when the pack has none.
 * Prices apply immediately (decided with the owner, 30 Sep 2026).
 */
export async function createItemFromScan(tx: Tx, p: NewItemInput): Promise<{ productId: number; variantId: number; barcode: string }> {
  const { orgId } = ctx();
  if (p.retailPriceCents <= 0) throw new ReceivingError("Set the retail price.");
  if (p.wholesalePriceCents < 0) throw new ReceivingError("Wholesale price can't be negative.");
  if (p.barcode) {
    if (!/^\d{6,14}$/.test(p.barcode)) throw new ReceivingError("That barcode doesn't look right.");
    if (await variantByBarcode(tx, p.barcode)) throw new ReceivingError("That barcode is already on a product.");
  }

  let productId: number;
  let option1Value: string | null = null;
  if (p.attachToProductId) {
    const [prod] = await tx.select().from(products).where(and(eq(products.orgId, orgId), eq(products.id, p.attachToProductId))).limit(1);
    if (!prod) throw new ReceivingError("That product no longer exists.");
    if (!p.optionValue?.trim()) throw new ReceivingError("Name the shade or size, e.g. “Honey”.");
    productId = prod.id;
    option1Value = p.optionValue.trim();
    if (!prod.option1Name) {
      // First extra shade of a single-version product: turn it into a product with options.
      const [existing] = await tx.select().from(variants).where(eq(variants.productId, prod.id)).orderBy(asc(variants.id)).limit(1);
      await tx.update(products).set({ option1Name: "Shade", updatedAt: new Date() }).where(eq(products.id, prod.id));
      if (existing && !existing.option1Value) await tx.update(variants).set({ option1Value: "Original" }).where(eq(variants.id, existing.id));
    }
    const [clash] = await tx.select({ id: variants.id }).from(variants).where(and(eq(variants.productId, prod.id), eq(variants.option1Value, option1Value))).limit(1);
    if (clash) throw new ReceivingError(`“${option1Value}” already exists on this product.`);
  } else {
    if (p.name.trim().length < 2) throw new ReceivingError("Give the product a name.");
    let brandId: number | null = null;
    if (p.brandName?.trim()) {
      const [b] = await tx
        .insert(brands)
        .values({ orgId, name: p.brandName.trim() })
        .onConflictDoUpdate({ target: [brands.orgId, brands.name], set: { archived: false } })
        .returning({ id: brands.id });
      brandId = b.id;
    }
    const [prod] = await tx.insert(products).values({ orgId, name: p.name.trim(), brandId, categoryId: p.categoryId }).returning({ id: products.id });
    productId = prod.id;
  }

  const [v] = await tx
    .insert(variants)
    .values({ orgId, productId, option1Value, retailPriceCents: p.retailPriceCents, wholesalePriceCents: p.wholesalePriceCents, swatchHex: p.swatchHex })
    .returning({ id: variants.id });

  let barcode = p.barcode;
  if (!barcode) {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(variantBarcodes).where(and(eq(variantBarcodes.orgId, orgId), eq(variantBarcodes.source, "generated")));
    for (let seq = n + 1; ; seq++) {
      const code = inStoreEan13(orgId, seq);
      if (!(await variantByBarcode(tx, code))) { barcode = code; break; }
    }
  }
  await tx.insert(variantBarcodes).values({ orgId, variantId: v.id, code: barcode!, source: p.barcode ? "manufacturer" : "generated" });
  return { productId, variantId: v.id, barcode: barcode! };
}
