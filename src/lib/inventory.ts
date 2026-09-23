import { and, asc, eq, gt, lt, sql } from "drizzle-orm";
import { locations, orgs, stockLots, stockMovements, type DbOrTx, type Tx } from "@/db";
import { ctx } from "./context";

/**
 * FIFO stock. Lots track remaining quantity AND remaining cost, so the sum of
 * remaining_cost_cents across lots always equals the Inventory GL balance.
 *
 * Selling more than is recorded (a shelf-count error) creates a *deficit lot*
 * (negative remaining qty/cost at the last known unit cost). The next receipt
 * settles the deficit first and returns the cost difference, which the caller
 * must post (Dr COGS / Cr Inventory, or the reverse) inside the same entry.
 */

export class InsufficientStockError extends Error {}

export async function defaultLocationId(db: DbOrTx): Promise<number> {
  const { orgId } = ctx();
  const [row] = await db
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.orgId, orgId), eq(locations.isDefault, true)))
    .limit(1);
  if (!row) throw new Error("No default location — run the seed.");
  return row.id;
}

/** Proportional cost of taking `take` units from a lot, exact on the last unit. */
function costOfTake(lot: { remainingQty: number; remainingCostCents: number }, take: number): number {
  return take === lot.remainingQty ? lot.remainingCostCents : Math.round((lot.remainingCostCents * take) / lot.remainingQty);
}

export interface AddStockResult {
  lotId: number;
  /** Real cost of units that settled a deficit minus what was estimated at sale time. Post as Dr COGS / Cr Inventory. */
  deficitVarianceCents: number;
}

/** Adds stock (bill, opening, return, positive adjustment). */
export async function addStock(
  tx: Tx,
  p: {
    variantId: number;
    qty: number;
    totalCostCents: number;
    date: string;
    sourceType: "opening" | "bill" | "return" | "adjustment" | "stocktake";
    sourceId?: number;
    locationId?: number;
  }
): Promise<AddStockResult> {
  if (!Number.isInteger(p.qty) || p.qty <= 0) throw new Error("Quantity must be a whole number above zero.");
  if (!Number.isInteger(p.totalCostCents) || p.totalCostCents < 0) throw new Error("Cost must be whole cents, zero or more.");
  const { orgId } = ctx();
  const locationId = p.locationId ?? (await defaultLocationId(tx));

  let remainingQty = p.qty;
  let remainingCost = p.totalCostCents;
  let variance = 0;

  // Settle deficits (oldest first) before the new lot becomes sellable.
  const deficits = await tx
    .select()
    .from(stockLots)
    .where(and(eq(stockLots.orgId, orgId), eq(stockLots.variantId, p.variantId), eq(stockLots.locationId, locationId), lt(stockLots.remainingQty, 0)))
    .orderBy(asc(stockLots.id))
    .for("update");
  for (const d of deficits) {
    if (remainingQty === 0) break;
    const owed = -d.remainingQty;
    const settle = Math.min(owed, remainingQty);
    const realCost = costOfTake({ remainingQty, remainingCostCents: remainingCost }, settle);
    const estimated = settle === owed ? -d.remainingCostCents : Math.round((-d.remainingCostCents * settle) / owed);
    variance += realCost - estimated;
    remainingQty -= settle;
    remainingCost -= realCost;
    await tx
      .update(stockLots)
      .set({ remainingQty: d.remainingQty + settle, remainingCostCents: d.remainingCostCents + estimated })
      .where(eq(stockLots.id, d.id));
  }

  const [lot] = await tx
    .insert(stockLots)
    .values({
      orgId,
      variantId: p.variantId,
      locationId,
      date: p.date,
      qty: p.qty,
      remainingQty,
      totalCostCents: p.totalCostCents,
      // The part of the cost that settled deficits left inventory via the variance.
      remainingCostCents: remainingCost,
      sourceType: p.sourceType,
      sourceId: p.sourceId,
    })
    .returning({ id: stockLots.id });

  await tx.insert(stockMovements).values({
    orgId,
    variantId: p.variantId,
    locationId,
    qtyDelta: p.qty,
    costCents: p.totalCostCents,
    sourceType: p.sourceType,
    sourceId: p.sourceId,
  });

  return { lotId: lot.id, deficitVarianceCents: variance };
}

export interface RemoveStockResult {
  /** FIFO cost of the units removed (including any deficit estimate). Post Dr COGS/Loss, Cr Inventory. */
  costCents: number;
  /** Units sold beyond recorded stock. */
  shortfallQty: number;
}

/** Removes stock oldest-first (sale, negative adjustment, stock-take shortfall). */
export async function removeStock(
  tx: Tx,
  p: {
    variantId: number;
    qty: number;
    date: string;
    sourceType: "sale" | "adjustment" | "stocktake" | "supplier_return";
    sourceId?: number;
    locationId?: number;
  }
): Promise<RemoveStockResult> {
  if (!Number.isInteger(p.qty) || p.qty <= 0) throw new Error("Quantity must be a whole number above zero.");
  const { orgId } = ctx();
  const locationId = p.locationId ?? (await defaultLocationId(tx));

  const lots = await tx
    .select()
    .from(stockLots)
    .where(and(eq(stockLots.orgId, orgId), eq(stockLots.variantId, p.variantId), eq(stockLots.locationId, locationId), gt(stockLots.remainingQty, 0)))
    .orderBy(asc(stockLots.date), asc(stockLots.id))
    .for("update");

  let need = p.qty;
  let cost = 0;
  for (const lot of lots) {
    if (need === 0) break;
    const take = Math.min(lot.remainingQty, need);
    const c = costOfTake(lot, take);
    cost += c;
    need -= take;
    await tx
      .update(stockLots)
      .set({ remainingQty: lot.remainingQty - take, remainingCostCents: lot.remainingCostCents - c })
      .where(eq(stockLots.id, lot.id));
  }

  if (need > 0) {
    const [org] = await tx.select({ allow: orgs.allowNegativeStock }).from(orgs).where(eq(orgs.id, orgId)).limit(1);
    if (!org?.allow || p.sourceType !== "sale") {
      throw new InsufficientStockError(`Only ${p.qty - need} in stock, ${p.qty} requested.`);
    }
    const unitCost = await lastUnitCostCents(tx, p.variantId, locationId);
    const estimate = need * unitCost;
    cost += estimate;
    await tx.insert(stockLots).values({
      orgId,
      variantId: p.variantId,
      locationId,
      date: p.date,
      qty: 0,
      remainingQty: -need,
      totalCostCents: 0,
      remainingCostCents: -estimate,
      sourceType: "deficit",
      sourceId: p.sourceId,
    });
  }

  await tx.insert(stockMovements).values({
    orgId,
    variantId: p.variantId,
    locationId,
    qtyDelta: -p.qty,
    costCents: -cost,
    sourceType: p.sourceType,
    sourceId: p.sourceId,
  });

  return { costCents: cost, shortfallQty: need };
}

/** Unit cost of the most recent real lot, for estimating deficits. 0 if never stocked. */
async function lastUnitCostCents(db: DbOrTx, variantId: number, locationId: number): Promise<number> {
  const { orgId } = ctx();
  const [lot] = await db
    .select({ qty: stockLots.qty, total: stockLots.totalCostCents })
    .from(stockLots)
    .where(and(eq(stockLots.orgId, orgId), eq(stockLots.variantId, variantId), eq(stockLots.locationId, locationId), gt(stockLots.qty, 0)))
    .orderBy(sql`${stockLots.id} desc`)
    .limit(1);
  return lot ? Math.round(lot.total / lot.qty) : 0;
}

export async function onHand(db: DbOrTx, variantId: number, locationId?: number): Promise<{ qty: number; valueCents: number }> {
  const { orgId } = ctx();
  const conds = [eq(stockLots.orgId, orgId), eq(stockLots.variantId, variantId)];
  if (locationId) conds.push(eq(stockLots.locationId, locationId));
  const [row] = await db
    .select({
      qty: sql<string>`coalesce(sum(${stockLots.remainingQty}), 0)`,
      value: sql<string>`coalesce(sum(${stockLots.remainingCostCents}), 0)`,
    })
    .from(stockLots)
    .where(and(...conds));
  return { qty: Number(row.qty), valueCents: Number(row.value) };
}

/** Total stock value across all lots — must equal the Inventory GL balance. */
export async function totalStockValueCents(db: DbOrTx): Promise<number> {
  const { orgId } = ctx();
  const [row] = await db
    .select({ value: sql<string>`coalesce(sum(${stockLots.remainingCostCents}), 0)` })
    .from(stockLots)
    .where(eq(stockLots.orgId, orgId));
  return Number(row.value);
}
