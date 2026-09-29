import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { brands, categories, products, stockTakeLines, stockTakes, variants, type DbOrTx, type Tx } from "@/db";
import { SYS } from "./coa";
import { ctx } from "./context";
import { addStock, defaultLocationId, lastUnitCostCents, onHand, removeStock } from "./inventory";
import { acct, postEntry, signedPair } from "./ledger";

/**
 * Weekly stock take.
 *
 * 1. Start: pick a scope (everything, some categories, or some brands). One
 *    line per product variant in scope.
 * 2. Count (blind): each save stores the counted quantity AND what the system
 *    said at that moment. Sales carry on during the count.
 * 3. Submit, then the owner reviews differences and approves. Only
 *    counted − system-at-count is adjusted, so sales after a line was counted
 *    are never double-corrected. Uncounted lines are left alone.
 */

export class StockTakeError extends Error {}

export type Scope = { all: true } | { categoryIds: number[] } | { brandIds: number[] };

async function loadTake(db: DbOrTx, id: number) {
  const [take] = await db.select().from(stockTakes).where(and(eq(stockTakes.orgId, ctx().orgId), eq(stockTakes.id, id))).limit(1);
  if (!take) throw new StockTakeError("Stock take not found.");
  return take;
}

export async function startStockTake(tx: Tx, scope: Scope): Promise<number> {
  const { orgId, memberId } = ctx();
  if (!memberId) throw new StockTakeError("Sign in to start a count.");
  const locationId = await defaultLocationId(tx);

  const [busy] = await tx
    .select({ id: stockTakes.id })
    .from(stockTakes)
    .where(and(eq(stockTakes.orgId, orgId), eq(stockTakes.locationId, locationId), inArray(stockTakes.status, ["counting", "submitted"])))
    .limit(1);
  if (busy) throw new StockTakeError("A stock take is already in progress. Finish or cancel it first.");

  // Resolve the scope to variants, and a human label for lists.
  let label = "Everything";
  const conds = [eq(variants.orgId, orgId), eq(variants.archived, false), eq(products.archived, false)];
  if ("categoryIds" in scope) {
    if (scope.categoryIds.length === 0) throw new StockTakeError("Pick at least one category.");
    const cats = await tx.select().from(categories).where(eq(categories.orgId, orgId));
    const picked = new Set(scope.categoryIds);
    // A top-level category includes its sub-categories.
    const ids = cats.filter((c) => picked.has(c.id) || (c.parentId !== null && picked.has(c.parentId))).map((c) => c.id);
    conds.push(inArray(products.categoryId, ids.length ? ids : [-1]));
    label = cats.filter((c) => picked.has(c.id)).map((c) => c.name).join(", ");
  } else if ("brandIds" in scope) {
    if (scope.brandIds.length === 0) throw new StockTakeError("Pick at least one brand.");
    conds.push(inArray(products.brandId, scope.brandIds));
    const names = await tx.select({ name: brands.name }).from(brands).where(and(eq(brands.orgId, orgId), inArray(brands.id, scope.brandIds)));
    label = names.map((b) => b.name).join(", ");
  }

  const inScope = await tx.select({ id: variants.id }).from(variants).innerJoin(products, eq(products.id, variants.productId)).where(and(...conds));
  if (inScope.length === 0) throw new StockTakeError("There are no products in that selection.");

  const [take] = await tx.insert(stockTakes).values({ orgId, locationId, scope, scopeLabel: label, startedBy: memberId }).returning({ id: stockTakes.id });
  await tx.insert(stockTakeLines).values(inScope.map((v) => ({ orgId, stockTakeId: take.id, variantId: v.id })));
  return take.id;
}

/**
 * Saves a count. `mode: "add"` is for scanning (each scan +1); `"set"` is for
 * typing the total. Variants found outside the scope are added to the count.
 */
export async function recordCount(tx: Tx, p: { stockTakeId: number; variantId: number; qty: number; mode: "set" | "add" }): Promise<number> {
  const { orgId, memberId } = ctx();
  if (!Number.isInteger(p.qty) || (p.mode === "set" && p.qty < 0)) throw new StockTakeError("Counts are whole numbers, zero or more.");
  const take = await loadTake(tx, p.stockTakeId);
  if (take.status !== "counting") throw new StockTakeError("This count has been submitted — it can't be changed.");
  const [variant] = await tx.select({ id: variants.id }).from(variants).where(and(eq(variants.orgId, orgId), eq(variants.id, p.variantId))).limit(1);
  if (!variant) throw new StockTakeError("Unknown product.");

  const system = (await onHand(tx, p.variantId, take.locationId)).qty;
  const [existing] = await tx
    .select()
    .from(stockTakeLines)
    .where(and(eq(stockTakeLines.stockTakeId, take.id), eq(stockTakeLines.variantId, p.variantId)))
    .for("update");
  const counted = p.mode === "add" ? (existing?.countedQty ?? 0) + p.qty : p.qty;
  if (counted < 0) throw new StockTakeError("The count can't go below zero.");

  const values = { countedQty: counted, systemQtyAtCount: system, countedBy: memberId, countedAt: new Date() };
  if (existing) await tx.update(stockTakeLines).set(values).where(eq(stockTakeLines.id, existing.id));
  else await tx.insert(stockTakeLines).values({ orgId, stockTakeId: take.id, variantId: p.variantId, ...values });
  return counted;
}

export async function submitStockTake(tx: Tx, stockTakeId: number) {
  const { memberId } = ctx();
  const take = await loadTake(tx, stockTakeId);
  if (take.status !== "counting") throw new StockTakeError("This count was already submitted.");
  const counted = await tx.select({ id: stockTakeLines.id }).from(stockTakeLines).where(and(eq(stockTakeLines.stockTakeId, take.id), isNotNull(stockTakeLines.countedQty))).limit(1);
  if (counted.length === 0) throw new StockTakeError("Count at least one product before submitting.");
  await tx.update(stockTakes).set({ status: "submitted", submittedBy: memberId, submittedAt: new Date() }).where(eq(stockTakes.id, take.id));
}

export async function cancelStockTake(tx: Tx, stockTakeId: number) {
  const { memberId } = ctx();
  const take = await loadTake(tx, stockTakeId);
  if (!["counting", "submitted"].includes(take.status)) throw new StockTakeError("This count is already closed.");
  await tx.update(stockTakes).set({ status: "cancelled", decidedBy: memberId, decidedAt: new Date() }).where(eq(stockTakes.id, take.id));
}

export interface ReviewLine {
  variantId: number;
  name: string;
  countedQty: number | null;
  systemQtyAtCount: number | null;
  differenceQty: number | null;
  /** Estimated value of the difference at the variant's average cost (negative = shortage). */
  differenceCents: number | null;
}

/** Differences for the owner to review, largest shortages first. */
export async function reviewStockTake(db: DbOrTx, stockTakeId: number): Promise<ReviewLine[]> {
  const take = await loadTake(db, stockTakeId);
  const rows = await db
    .select({ line: stockTakeLines, product: products.name, o1: variants.option1Value, o2: variants.option2Value })
    .from(stockTakeLines)
    .innerJoin(variants, eq(variants.id, stockTakeLines.variantId))
    .innerJoin(products, eq(products.id, variants.productId))
    .where(eq(stockTakeLines.stockTakeId, take.id))
    .orderBy(asc(products.name));
  const out: ReviewLine[] = [];
  for (const r of rows) {
    const diff = r.line.countedQty === null || r.line.systemQtyAtCount === null ? null : r.line.countedQty - r.line.systemQtyAtCount;
    let cents: number | null = null;
    if (diff !== null && diff !== 0) {
      const oh = await onHand(db, r.line.variantId, take.locationId);
      const unit = oh.qty > 0 ? oh.valueCents / oh.qty : await lastUnitCostCents(db, r.line.variantId, take.locationId);
      cents = Math.round(diff * unit);
    } else if (diff === 0) cents = 0;
    out.push({
      variantId: r.line.variantId,
      name: [r.product, r.o1, r.o2].filter(Boolean).join(" · "),
      countedQty: r.line.countedQty,
      systemQtyAtCount: r.line.systemQtyAtCount,
      differenceQty: diff,
      differenceCents: cents,
    });
  }
  return out.sort((a, b) => (a.differenceCents ?? 0) - (b.differenceCents ?? 0));
}

/**
 * Owner approval: adjusts every counted line by (counted − system at count).
 * Shortages leave at FIFO cost, surpluses come back at the last price paid.
 * One journal entry: Dr/Cr Stock Loss vs Inventory.
 */
export async function approveStockTake(tx: Tx, stockTakeId: number, date: string): Promise<{ varianceCostCents: number; linesAdjusted: number }> {
  const { memberId, role } = ctx();
  if (role !== "owner") throw new StockTakeError("Only the owner can approve a stock take.");
  const take = await loadTake(tx, stockTakeId);
  if (take.status !== "submitted") throw new StockTakeError("Submit the count before approving it.");
  await tx.select({ id: stockTakes.id }).from(stockTakes).where(eq(stockTakes.id, take.id)).for("update");

  const lines = await tx.select().from(stockTakeLines).where(and(eq(stockTakeLines.stockTakeId, take.id), isNotNull(stockTakeLines.countedQty)));
  let shortageCost = 0;
  let surplusCost = 0;
  let deficitVariance = 0;
  let adjusted = 0;
  for (const l of lines) {
    const diff = l.countedQty! - l.systemQtyAtCount!;
    if (diff === 0) {
      await tx.update(stockTakeLines).set({ adjustedQty: 0, adjustedCostCents: 0 }).where(eq(stockTakeLines.id, l.id));
      continue;
    }
    let cost: number;
    if (diff < 0) {
      // A shortage can't exceed what's on the books now (sales since the count may have used it up).
      const available = Math.max(0, (await onHand(tx, l.variantId, take.locationId)).qty);
      const qtyOut = Math.min(-diff, available);
      cost = qtyOut > 0 ? (await removeStock(tx, { variantId: l.variantId, qty: qtyOut, date, sourceType: "stocktake", sourceId: take.id, locationId: take.locationId })).costCents : 0;
      shortageCost += cost;
      await tx.update(stockTakeLines).set({ adjustedQty: -qtyOut, adjustedCostCents: -cost }).where(eq(stockTakeLines.id, l.id));
      if (qtyOut > 0) adjusted++;
    } else {
      cost = diff * (await lastUnitCostCents(tx, l.variantId, take.locationId));
      const r = await addStock(tx, { variantId: l.variantId, qty: diff, totalCostCents: cost, date, sourceType: "stocktake", sourceId: take.id, locationId: take.locationId });
      surplusCost += cost;
      deficitVariance += r.deficitVarianceCents;
      await tx.update(stockTakeLines).set({ adjustedQty: diff, adjustedCostCents: cost }).where(eq(stockTakeLines.id, l.id));
      adjusted++;
    }
  }

  const inv = await acct(tx, SYS.INVENTORY);
  const loss = await acct(tx, SYS.STOCK_LOSS);
  const journal = [
    ...signedPair(shortageCost, loss, inv, "Stock take shortages"),
    ...signedPair(surplusCost, inv, loss, "Stock take surpluses"),
    ...signedPair(deficitVariance, await acct(tx, SYS.COGS), inv, "Settle oversold stock"),
  ];
  const journalEntryId = journal.length
    ? await postEntry(tx, { date, memo: `Stock take #${take.id} (${take.scopeLabel})`, sourceType: "stock_take", sourceId: take.id, lines: journal })
    : null;

  const varianceCostCents = surplusCost - shortageCost;
  await tx
    .update(stockTakes)
    .set({ status: "approved", decidedBy: memberId, decidedAt: new Date(), varianceCostCents, journalEntryId })
    .where(eq(stockTakes.id, take.id));
  return { varianceCostCents, linesAdjusted: adjusted };
}

