import type { Tx } from "@/db";
import { SYS } from "./coa";
import { addStock, removeStock } from "./inventory";
import { acct, postEntry, signedPair, type PostLine } from "./ledger";

/**
 * Stock events that aren't sales or bills. Each posts its journal in the
 * same transaction as the stock movement.
 */

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

/**
 * Manual stock adjustment. Negative qty removes stock at FIFO cost
 * (Dr Stock Loss or Drawings / Cr Inventory). Positive "found" stock comes
 * back at the latest cost supplied by the caller (Dr Inventory / Cr Stock Loss).
 */
export async function postStockAdjustment(
  tx: Tx,
  p: { variantId: number; qtyDelta: number; reason: AdjustmentReason; date: string; adjustmentId?: number; foundUnitCostCents?: number }
): Promise<number> {
  if (p.qtyDelta === 0) throw new Error("Adjustment quantity can't be zero.");
  const inv = await acct(tx, SYS.INVENTORY);
  const loss = await acct(tx, p.reason === "owner_use" ? SYS.DRAWINGS : SYS.STOCK_LOSS);
  let lines: PostLine[];
  if (p.qtyDelta < 0) {
    const { costCents } = await removeStock(tx, { variantId: p.variantId, qty: -p.qtyDelta, date: p.date, sourceType: "adjustment", sourceId: p.adjustmentId });
    lines = signedPair(costCents, loss, inv, `Stock adjustment: ${p.reason}`);
  } else {
    const cost = p.qtyDelta * (p.foundUnitCostCents ?? 0);
    const { deficitVarianceCents } = await addStock(tx, { variantId: p.variantId, qty: p.qtyDelta, totalCostCents: cost, date: p.date, sourceType: "adjustment", sourceId: p.adjustmentId });
    lines = [...signedPair(cost, inv, loss, `Stock adjustment: ${p.reason}`), ...signedPair(deficitVarianceCents, await acct(tx, SYS.COGS), inv, "Settle oversold stock")];
  }
  if (lines.length === 0) return 0; // zero-cost item: stock moved, nothing to post
  return postEntry(tx, { date: p.date, memo: `Stock adjustment (${p.reason})`, sourceType: "stock_adjustment", sourceId: p.adjustmentId, lines });
}
