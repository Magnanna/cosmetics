"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { audit, ForbiddenError, withSession } from "@/lib/auth";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { products } from "@/db";
import { ImageError } from "@/lib/images";
import { MagnificError } from "@/lib/magnific";
import { makeStudioPhoto, StudioError, undoStudioPhoto } from "@/lib/studio-db";
import { addBarcode, addVariant, CatalogError, changePrices, decidePriceRequest, removeBarcode, updateProduct, updateVariant } from "@/lib/catalog";

type R = { ok: true; message: string } | { ok: false; error: string };

async function run(fn: () => Promise<string>, productId?: number): Promise<R> {
  try {
    const message = await fn();
    revalidatePath("/products");
    if (productId) revalidatePath(`/products/${productId}`);
    revalidatePath("/till");
    return { ok: true, message };
  } catch (e) {
    if (e instanceof CatalogError || e instanceof ForbiddenError || e instanceof StudioError || e instanceof MagnificError || e instanceof ImageError) return { ok: false, error: e.message };
    throw e;
  }
}

const cents = z.number().int().min(0).max(100_000_000);

export async function saveProduct(raw: { productId: number; name: string; brandName: string | null; categoryId: number | null; option1Name: string | null; option2Name: string | null; archived: boolean }): Promise<R> {
  return run(() =>
    withSession("catalog.edit", () =>
      db.transaction(async (tx) => {
        const r = await updateProduct(tx, raw);
        await audit(tx, { action: raw.archived && !r.before.archived ? "product.archive" : "product.update", entity: "product", entityId: raw.productId, before: r.before, after: r.after });
        return raw.archived ? "Archived — it no longer shows on the till." : "Saved.";
      })
    ), raw.productId);
}

const VariantInput = z.object({
  productId: z.number().int(),
  variantId: z.number().int(),
  option1Value: z.string().max(60).nullable(),
  option2Value: z.string().max(60).nullable(),
  reorderLevel: z.number().int().min(0),
  swatchHex: z.string().nullable(),
  archived: z.boolean(),
  retailPriceCents: cents,
  wholesalePriceCents: cents,
  reason: z.string().max(200).nullable(),
});

export async function saveVariant(raw: z.infer<typeof VariantInput>): Promise<R> {
  const p = VariantInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "Check the prices and reorder level." };
  const v = p.data;
  return run(() =>
    withSession("catalog.edit", () =>
      db.transaction(async (tx) => {
        const r = await updateVariant(tx, v);
        await audit(tx, { action: v.archived && !r.before.archived ? "variant.archive" : "variant.update", entity: "variant", entityId: v.variantId, before: r.before, after: r.after });
        const price = await changePrices(tx, v);
        if (price !== "unchanged") {
          await audit(tx, { action: price === "applied" ? "price.change" : "price.suggest", entity: "variant", entityId: v.variantId, before: { retail: r.before.retailPriceCents, wholesale: r.before.wholesalePriceCents }, after: { retail: v.retailPriceCents, wholesale: v.wholesalePriceCents, reason: v.reason } });
        }
        return price === "requested" ? "Saved. The new price goes to the owner for approval." : "Saved.";
      })
    ), v.productId);
}

export async function newVariant(raw: { productId: number; option1Value: string; option2Value: string | null; retailPriceCents: number; wholesalePriceCents: number; barcode: string | null }): Promise<R> {
  return run(() =>
    // New variants take the price given, whoever adds them (same rule as new products).
    withSession("catalog.edit", () => {
      return db.transaction(async (tx) => {
        const id = await addVariant(tx, raw);
        await audit(tx, { action: "variant.create", entity: "variant", entityId: id, after: raw });
        return "Variant added.";
      });
    }), raw.productId);
}

export async function barcodeAdd(productId: number, variantId: number, code: string | null): Promise<R> {
  return run(() =>
    withSession("catalog.edit", () =>
      db.transaction(async (tx) => {
        const c = await addBarcode(tx, { variantId, code });
        await audit(tx, { action: "barcode.add", entity: "variant", entityId: variantId, after: { code: c } });
        return `Barcode ${c} added.`;
      })
    ), productId);
}

export async function barcodeRemove(productId: number, barcodeId: number): Promise<R> {
  return run(() =>
    withSession("catalog.edit", () =>
      db.transaction(async (tx) => {
        const b = await removeBarcode(tx, barcodeId);
        await audit(tx, { action: "barcode.remove", entity: "variant", entityId: b.variantId, before: { code: b.code } });
        return `Barcode ${b.code} removed.`;
      })
    ), productId);
}

export async function decidePrice(requestId: number, approve: boolean): Promise<R> {
  const res = await run(() =>
    withSession("catalog.set_prices", () =>
      db.transaction(async (tx) => {
        const r = await decidePriceRequest(tx, requestId, approve);
        await audit(tx, { action: approve ? "price.approve" : "price.reject", entity: "variant", entityId: r.variantId, after: { field: r.field, from: r.oldCents, to: r.newCents } });
        return approve ? "Price updated." : "Suggestion rejected.";
      })
    ));
  revalidatePath("/products/prices");
  return res;
}

/** Studio photo for one product (Magnific cut-out on the brand backdrop). */
export async function studioPhoto(productId: number): Promise<R> {
  return run(() =>
    withSession("catalog.edit", async (s) => {
      await makeStudioPhoto(s.org.id, productId);
      await audit(db, { action: "product.studio_photo", entity: "product", entityId: productId });
      return "Studio photo ready.";
    }), productId);
}

export async function undoStudio(productId: number): Promise<R> {
  return run(() =>
    withSession("catalog.edit", async (s) => {
      await undoStudioPhoto(s.org.id, productId);
      return "Back to the original photo.";
    }), productId);
}

/** Products with a photo that isn't a studio photo yet (for "Make all studio photos"). */
export async function studioPending(): Promise<number[]> {
  return withSession("catalog.edit", async (s) => {
    const rows = await db.select({ id: products.id }).from(products).where(and(eq(products.orgId, s.org.id), eq(products.archived, false), isNotNull(products.imageUrl), isNull(products.imageOriginalUrl)));
    return rows.map((r) => r.id);
  });
}
