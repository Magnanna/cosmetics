"use server";

import os from "node:os";
import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, photoTokens, products } from "@/db";
import { audit, ForbiddenError, withSession } from "@/lib/auth";
import { lookupBarcode, teachBarcode, type BarcodeInfo } from "@/lib/barcode-lookup";
import { copyRemoteImage, imagesEnabled } from "@/lib/images";
import { PurchasingError } from "@/lib/purchasing";
import {
  addToReceiving, createItemFromScan, discardReceiving, postReceiving, ReceivingError, startReceiving, updateReceivingLine, variantByBarcode,
} from "@/lib/receiving";

type R<T = null> = { ok: true; data: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>): Promise<R<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof ReceivingError || e instanceof PurchasingError || e instanceof ForbiddenError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong. Try again." };
  }
}

const Start = z.object({
  supplierId: z.coerce.number().int(),
  supplierInvoiceNo: z.string().trim().min(1, "Type the invoice number."),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ratesIncludeVat: z.enum(["yes", "no"]),
});

export async function newDelivery(_: unknown, form: FormData): Promise<{ error?: string }> {
  const parsed = Start.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const v = parsed.data;
  const res = await run(() =>
    withSession("stock.receive", () =>
      db.transaction((tx) => startReceiving(tx, { ...v, ratesIncludeVat: v.ratesIncludeVat === "yes" }))
    )
  );
  if (!res.ok) return { error: res.error };
  redirect(`/stock/receive/${res.data}`);
}

export type ScanResult =
  | { kind: "added"; variantId: number; qty: number }
  | { kind: "new"; code: string; suggestion: BarcodeInfo | null };

/** A barcode was scanned: known → +1; unknown → look it up online for the new-item form. */
export async function scan(receivingId: number, rawCode: string): Promise<R<ScanResult>> {
  const code = rawCode.trim();
  return run(() =>
    withSession("stock.receive", async () => {
      const variantId = await variantByBarcode(db, code);
      if (variantId) {
        const qty = await db.transaction((tx) => addToReceiving(tx, receivingId, variantId, 1));
        return { kind: "added" as const, variantId, qty };
      }
      if (!/^\d{6,14}$/.test(code)) throw new ReceivingError("That doesn't look like a barcode. Search by name instead.");
      return { kind: "new" as const, code, suggestion: await lookupBarcode(code) };
    })
  );
}

export async function addExisting(receivingId: number, variantId: number, qty: number): Promise<R<number>> {
  return run(() => withSession("stock.receive", () => db.transaction((tx) => addToReceiving(tx, receivingId, variantId, qty))));
}

const NewItem = z.object({
  barcode: z.string().regex(/^\d{6,14}$/).nullable(),
  name: z.string().trim().max(120),
  brandName: z.string().trim().max(60).nullable(),
  categoryId: z.number().int().nullable(),
  attachToProductId: z.number().int().nullable(),
  optionValue: z.string().trim().max(60).nullable(),
  swatchHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
  retailPriceCents: z.number().int().min(0),
  wholesalePriceCents: z.number().int().min(0),
  qty: z.number().int().min(1).max(100_000),
  unitRateCents: z.number().int().min(0).nullable(),
  imageUrl: z.string().url().nullable(),
});

/** Creates the product from the scan (prices apply now) and adds it to the delivery. */
export async function createAndAdd(receivingId: number, raw: z.infer<typeof NewItem>): Promise<R<{ variantId: number; productId: number }>> {
  const parsed = NewItem.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const p = parsed.data;
  return run(() =>
    withSession("stock.receive", async (s) => {
      const created = await db.transaction(async (tx) => {
        const item = await createItemFromScan(tx, p);
        await addToReceiving(tx, receivingId, item.variantId, p.qty);
        if (p.unitRateCents !== null) await updateReceivingLine(tx, receivingId, item.variantId, { unitRateCents: p.unitRateCents });
        await audit(tx, { action: "product.create_from_scan", entity: "variant", entityId: item.variantId, after: { ...p, barcode: item.barcode } });
        return item;
      });
      // Outside the transaction: copy the found photo into our storage and teach the shared library.
      if (p.imageUrl && !p.attachToProductId) {
        const stored = await copyRemoteImage(s.org.id, created.productId, p.imageUrl);
        if (stored) await db.update(products).set({ imageUrl: stored }).where(and(eq(products.id, created.productId), isNull(products.imageUrl)));
      }
      if (p.barcode) {
        const [prod] = await db.select({ name: products.name, imageUrl: products.imageUrl }).from(products).where(eq(products.id, created.productId)).limit(1);
        const name = p.attachToProductId && p.optionValue ? `${prod.name} ${p.optionValue}` : prod.name;
        await teachBarcode({ code: p.barcode, name, brand: p.brandName, imageUrl: prod.imageUrl });
      }
      return { variantId: created.variantId, productId: created.productId };
    })
  );
}

export async function editLine(receivingId: number, variantId: number, patch: { qty?: number; unitRateCents?: number | null }): Promise<R> {
  return run(() => withSession("stock.receive", async () => { await db.transaction((tx) => updateReceivingLine(tx, receivingId, variantId, patch)); return null; }));
}

export async function saveDelivery(receivingId: number): Promise<R<number>> {
  const res = await run(() =>
    withSession("stock.receive", () =>
      db.transaction(async (tx) => {
        const bill = await postReceiving(tx, receivingId);
        await audit(tx, { action: "bill.post", entity: "bill", entityId: bill.billId, after: { receivingId, totalCents: bill.totalCents } });
        return bill.billId;
      })
    )
  );
  if (res.ok) {
    revalidatePath("/stock/bills");
    revalidatePath("/products");
  }
  return res;
}

export async function discardDelivery(receivingId: number): Promise<R> {
  return run(() => withSession("stock.receive", async () => { await db.transaction((tx) => discardReceiving(tx, receivingId)); return null; }));
}

/**
 * A 30-minute link the phone opens to take the product photo. In local
 * development "localhost" is swapped for this computer's network address so
 * a phone on the same Wi-Fi can reach it.
 */
export async function phonePhotoLink(productId: number): Promise<R<{ url: string; enabled: boolean }>> {
  return run(() =>
    withSession("stock.receive", async (s) => {
      const [prod] = await db.select({ id: products.id }).from(products).where(and(eq(products.orgId, s.org.id), eq(products.id, productId))).limit(1);
      if (!prod) throw new ReceivingError("Unknown product.");
      const token = randomBytes(18).toString("base64url");
      await db.insert(photoTokens).values({ token, orgId: s.org.id, productId, expiresAt: new Date(Date.now() + 30 * 60_000) });
      const h = await headers();
      const proto = h.get("x-forwarded-proto") ?? "http";
      let host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
      if (/^(localhost|127\.0\.0\.1)(:|$)/.test(host)) {
        const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address;
        if (lan) host = host.replace(/^(localhost|127\.0\.0\.1)/, lan);
      }
      return { url: `${process.env.NEXT_PUBLIC_APP_URL ?? `${proto}://${host}`}/m/photo/${token}`, enabled: imagesEnabled() };
    })
  );
}
