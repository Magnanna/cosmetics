"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, type Tx } from "@/db";
import { audit, ForbiddenError, withSession } from "@/lib/auth";
import { postSupplierPayment, PurchasingError } from "@/lib/purchasing";
import { nairobiDate } from "@/lib/time";
import { InsufficientStockError } from "@/lib/inventory";
import { recordStockAdjustment, StockError } from "@/lib/stock-postings";
import { approveStockTake, cancelStockTake, recordCount, startStockTake, StockTakeError, submitStockTake, type Scope } from "@/lib/stocktake";

const PaymentInput = z.object({
  supplierId: z.coerce.number().int(),
  amount: z.coerce.number().positive("Enter an amount."),
  method: z.enum(["cash", "mpesa", "bank"]),
  reference: z.string().trim().max(60).optional(),
});

export async function paySupplier(_: unknown, form: FormData): Promise<{ error?: string; ok?: boolean }> {
  const parsed = PaymentInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const v = parsed.data;
  try {
    await withSession("books.post", () =>
      db.transaction(async (tx) => {
        const id = await postSupplierPayment(tx, { supplierId: v.supplierId, date: nairobiDate(), amountCents: Math.round(v.amount * 100), method: v.method, reference: v.reference || null });
        await audit(tx, { action: "supplier.pay", entity: "supplier_payment", entityId: id, after: v });
      })
    );
  } catch (e) {
    if (e instanceof PurchasingError || e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
  revalidatePath("/stock/bills");
  revalidatePath("/suppliers");
  return { ok: true };
}

/* ---------------- Adjustments ---------------- */

const AdjustInput = z.object({
  variantId: z.coerce.number().int(),
  direction: z.enum(["out", "in"]),
  qty: z.coerce.number().int().min(1, "Enter how many units."),
  reason: z.enum(["damaged", "lost", "found", "owner_use", "other"]),
  note: z.string().trim().max(300).optional(),
});

export async function adjustStock(_: unknown, form: FormData): Promise<{ error?: string; ok?: string }> {
  const parsed = AdjustInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const v = parsed.data;
  try {
    const r = await withSession("stock.receive", () =>
      db.transaction(async (tx) => {
        const res = await recordStockAdjustment(tx, { variantId: v.variantId, qtyDelta: v.direction === "out" ? -v.qty : v.qty, reason: v.reason, note: v.note, date: nairobiDate() });
        await audit(tx, { action: "stock.adjust", entity: "stock_adjustment", entityId: res.adjustmentId, after: { ...v, costCents: res.costCents } });
        return res;
      })
    );
    revalidatePath("/stock/adjust");
    return { ok: `Saved. Stock value changed by KES ${(r.costCents / 100).toLocaleString("en-KE", { minimumFractionDigits: 2 })}.` };
  } catch (e) {
    if (e instanceof StockError || e instanceof InsufficientStockError || e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
}

/* ---------------- Stock takes ---------------- */

type Plain = { ok: true } | { ok: false; error: string };
type WithId = { ok: true; id: number } | { ok: false; error: string };

function known(e: unknown): string | null {
  return e instanceof StockTakeError || e instanceof ForbiddenError || e instanceof InsufficientStockError ? (e as Error).message : null;
}

export async function beginStockTake(input: { kind: "all" } | { kind: "categories"; ids: number[] } | { kind: "brands"; ids: number[] }): Promise<WithId> {
  const scope: Scope = input.kind === "all" ? { all: true } : input.kind === "categories" ? { categoryIds: input.ids } : { brandIds: input.ids };
  try {
    const id = await withSession("stock.count", () =>
      db.transaction(async (tx) => {
        const id = await startStockTake(tx, scope);
        await audit(tx, { action: "stocktake.start", entity: "stock_take", entityId: id, after: scope });
        return id;
      })
    );
    revalidatePath("/stock/counts");
    return { ok: true, id };
  } catch (e) {
    const m = known(e);
    if (m) return { ok: false, error: m };
    throw e;
  }
}

export async function saveCount(input: { stockTakeId: number; variantId: number; qty: number; mode: "set" | "add" }): Promise<{ ok: true; counted: number } | { ok: false; error: string }> {
  try {
    const counted = await withSession("stock.count", () => db.transaction((tx) => recordCount(tx, input)));
    return { ok: true, counted };
  } catch (e) {
    const m = known(e);
    if (m) return { ok: false, error: m };
    throw e;
  }
}

export async function finishCounting(stockTakeId: number): Promise<Plain> {
  return decide(stockTakeId, "stock.count", "stocktake.submit", (tx) => submitStockTake(tx, stockTakeId));
}

export async function approveCount(stockTakeId: number): Promise<Plain> {
  return decide(stockTakeId, "stock.approve", "stocktake.approve", (tx) => approveStockTake(tx, stockTakeId, nairobiDate()));
}

export async function cancelCount(stockTakeId: number): Promise<Plain> {
  return decide(stockTakeId, "stock.approve", "stocktake.cancel", (tx) => cancelStockTake(tx, stockTakeId));
}

async function decide(stockTakeId: number, perm: "stock.count" | "stock.approve", action: string, fn: (tx: Tx) => Promise<unknown>): Promise<Plain> {
  try {
    await withSession(perm, () =>
      db.transaction(async (tx) => {
        const result = await fn(tx);
        await audit(tx, { action, entity: "stock_take", entityId: stockTakeId, after: result ?? null });
      })
    );
    revalidatePath("/stock/counts");
    revalidatePath(`/stock/counts/${stockTakeId}`);
    return { ok: true };
  } catch (e) {
    const m = known(e);
    if (m) return { ok: false, error: m };
    throw e;
  }
}
