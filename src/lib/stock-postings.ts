import { eq } from "drizzle-orm";
import { stockAdjustments, type Tx } from "@/db";
import { SYS } from "./coa";
import { ctx } from "./context";
import { addStock, defaultLocationId, lastUnitCostCents, removeStock } from "./inventory";
import { acct, postEntry, signedPair, type PostLine } from "./ledger";

/**
 * Stock events that aren't sales or bills. Each posts its journal in the
 * same transaction as the stock movement.
 */

export class StockError extends Error {}

/** Go-live stock count: Dr Inventory / Cr Opening Balance Equity. */
export async function postOpeningStock(
  tx: Tx,
  p: { variantId: number; qty: number; totalCostCents: number; date: string }
): Promise<number> {
  const inv = await acct(tx, SYS.INVENTORY);
  const { deficitVarianceCents } = await addStock(tx, { ...p, sourceType: "opening" });
  const lines: PostLine[] = [
    { accountId: inv, debitCents: p.totalCostCents, memo: "Opening stock" },
    { accountId: await acct(tx, SYS.OPENING_BALANCE), creditCents: p.totalCostCents },
    ...signedPair(deficitVarianceCents, await acct(tx, SYS.COGS), inv, "Settle oversold stock"),
  ];
  return postEntry(tx, { date: p.date, memo: "Opening stock", sourceType: "opening_stock", sourceId: p.variantId, lines });
}

export type AdjustmentReason = "damaged" | "lost" | "found" | "owner_use" | "other";

export const ADJUSTMENT_REASONS: Record<AdjustmentReason, string> = {
  damaged: "Damaged",
  lost: "Lost or stolen",
  found: "Found",
  owner_use: "Owner took for personal use",
  other: "Other",
};

/** Adjustments worth more than this need the owner (KES 1,000). */
export const ADJUSTMENT_OWNER_LIMIT_CENTS = 100_000;

/**
 * Manual stock adjustment with a reason.
 * Out: removes at FIFO cost → Dr Stock Loss (or Drawings for owner use) / Cr Inventory.
 * In ("found"): comes back at the last price paid → Dr Inventory / Cr Stock Loss.
 */
export async function recordStockAdjustment(
  tx: Tx,
  p: { variantId: number; qtyDelta: number; reason: AdjustmentReason; note?: string | null; date: string }
): Promise<{ adjustmentId: number; costCents: number }> {
  const { orgId, memberId, role } = ctx();
  if (!Number.isInteger(p.qtyDelta) || p.qtyDelta === 0) throw new StockError("Enter how many units to add or remove.");
  if (p.reason === "found" && p.qtyDelta < 0) throw new StockError("“Found” adds stock — use a positive number.");
  if (p.reason !== "found" && p.reason !== "other" && p.qtyDelta > 0) throw new StockError(`“${ADJUSTMENT_REASONS[p.reason]}” removes stock — use a negative number.`);
  if (p.reason === "other" && !p.note?.trim()) throw new StockError("Add a note explaining the adjustment.");

  const locationId = await defaultLocationId(tx);
  const [adj] = await tx
    .insert(stockAdjustments)
    .values({ orgId, variantId: p.variantId, qtyDelta: p.qtyDelta, reason: p.reason, note: p.note?.trim() || null, memberId })
    .returning({ id: stockAdjustments.id });

  const inv = await acct(tx, SYS.INVENTORY);
  const loss = await acct(tx, p.reason === "owner_use" ? SYS.DRAWINGS : SYS.STOCK_LOSS);
  let costCents: number;
  let lines: PostLine[];
  if (p.qtyDelta < 0) {
    ({ costCents } = await removeStock(tx, { variantId: p.variantId, qty: -p.qtyDelta, date: p.date, sourceType: "adjustment", sourceId: adj.id, locationId }));
    lines = signedPair(costCents, loss, inv, `Stock adjustment: ${p.reason}`);
  } else {
    costCents = p.qtyDelta * (await lastUnitCostCents(tx, p.variantId, locationId));
    const { deficitVarianceCents } = await addStock(tx, { variantId: p.variantId, qty: p.qtyDelta, totalCostCents: costCents, date: p.date, sourceType: "adjustment", sourceId: adj.id, locationId });
    lines = [...signedPair(costCents, inv, loss, `Stock adjustment: ${p.reason}`), ...signedPair(deficitVarianceCents, await acct(tx, SYS.COGS), inv, "Settle oversold stock")];
  }

  if (costCents > ADJUSTMENT_OWNER_LIMIT_CENTS && role !== "owner") {
    throw new StockError(`This adjustment is worth KES ${(costCents / 100).toLocaleString("en-KE")}. Adjustments over KES 1,000 need the owner.`);
  }

  let journalEntryId: number | null = null;
  if (lines.length > 0) {
    journalEntryId = await postEntry(tx, { date: p.date, memo: `Stock adjustment (${ADJUSTMENT_REASONS[p.reason]})`, sourceType: "stock_adjustment", sourceId: adj.id, lines });
  }
  await tx.update(stockAdjustments).set({ costCents, journalEntryId }).where(eq(stockAdjustments.id, adj.id));
  return { adjustmentId: adj.id, costCents };
}
