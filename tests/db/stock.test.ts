import { test, after } from "node:test";
import assert from "node:assert/strict";
import { loadEnv } from "../../scripts/env";
loadEnv();

const { db, orgs, products, variants, brands, journalLines, accounts, stockTakes, stockTakeLines } = await import("../../src/db");
const { eq, and, sql } = await import("drizzle-orm");
const { runWithOrg } = await import("../../src/lib/context");
const { postOpeningStock, recordStockAdjustment } = await import("../../src/lib/stock-postings");
const { startStockTake, recordCount, submitStockTake, approveStockTake, reviewStockTake } = await import("../../src/lib/stocktake");
const { onHand, removeStock, totalStockValueCents } = await import("../../src/lib/inventory");
const { SYS } = await import("../../src/lib/coa");
const { acct, postEntry } = await import("../../src/lib/ledger");

const [org] = await db.select().from(orgs).where(eq(orgs.slug, "kenfri")).limit(1);
const as = <T>(role: "owner" | "staff", fn: () => Promise<T>) => runWithOrg({ orgId: org.id, memberId: 999_002, role }, fn);

class Rollback extends Error {}
async function inRollback(fn: (tx: any) => Promise<void>) {
  await assert.rejects(db.transaction(async (tx) => { await fn(tx); throw new Rollback(); }), Rollback);
}
async function gl(tx: any, code: string) {
  const [r] = await tx.select({ b: sql<string>`coalesce(sum(${journalLines.debitCents} - ${journalLines.creditCents}),0)` })
    .from(journalLines).innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .where(and(eq(journalLines.orgId, org.id), eq(accounts.code, code)));
  return Number(r.b);
}
/** Balances move relative to whatever real data is already in the books. */
let baseline = new Map<string, number>();
async function balances(tx: any) {
  const rows = await tx.select({ code: accounts.code, b: sql<string>`coalesce(sum(${journalLines.debitCents} - ${journalLines.creditCents}),0)` })
    .from(journalLines).innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .where(eq(journalLines.orgId, org.id)).groupBy(accounts.code);
  return new Map<string, number>(rows.map((r: any) => [r.code, Number(r.b)]));
}
async function markBaseline(tx: any) { baseline = await balances(tx); }
async function moved(tx: any, code: string) { return ((await balances(tx)).get(code) ?? 0) - (baseline.get(code) ?? 0); }
async function trial(tx: any) {
  const [r] = await tx.select({ d: sql<string>`coalesce(sum(${journalLines.debitCents}),0)`, c: sql<string>`coalesce(sum(${journalLines.creditCents}),0)` })
    .from(journalLines).where(eq(journalLines.orgId, org.id));
  return Number(r.d) - Number(r.c);
}
async function variantOf(tx: any, name: string, brandId: number | null, qty: number, unitCost: number) {
  const [p] = await tx.insert(products).values({ orgId: org.id, name, brandId }).returning();
  const [v] = await tx.insert(variants).values({ orgId: org.id, productId: p.id, retailPriceCents: unitCost * 2 }).returning();
  if (qty) await postOpeningStock(tx, { variantId: v.id, qty, totalCostCents: qty * unitCost, date: "2026-09-29" });
  return v.id as number;
}

test("adjustments: reasons, owner limit, found stock at last cost", () =>
  inRollback(async (tx) => {
    const date = "2026-09-29";
    await markBaseline(tx);
    const v = await as("owner", () => variantOf(tx, "TEST Lotion 400ml", null, 20, 30_000)); // KES 300 each
    await as("staff", async () => {
      await recordStockAdjustment(tx, { variantId: v, qtyDelta: -2, reason: "damaged", date }); // KES 600, fine
      await assert.rejects(recordStockAdjustment(tx, { variantId: v, qtyDelta: 2, reason: "damaged", date }), /removes stock/);
      await assert.rejects(recordStockAdjustment(tx, { variantId: v, qtyDelta: -1, reason: "other", date }), /Add a note/);
    });
    // KES 1,200 of damage needs the owner — the staff attempt must not leave any trace
    await as("staff", () => assert.rejects(tx.transaction(async (sp: any) => recordStockAdjustment(sp, { variantId: v, qtyDelta: -4, reason: "damaged", date })), /need the owner/));
    await as("owner", async () => {
      await recordStockAdjustment(tx, { variantId: v, qtyDelta: -4, reason: "damaged", date });
      await recordStockAdjustment(tx, { variantId: v, qtyDelta: -1, reason: "owner_use", date });
      await recordStockAdjustment(tx, { variantId: v, qtyDelta: 3, reason: "found", date });
      assert.deepEqual(await onHand(tx, v), { qty: 16, valueCents: 16 * 30_000 });
      assert.equal(await moved(tx, SYS.DRAWINGS), 30_000);
      assert.equal(await moved(tx, SYS.STOCK_LOSS), 6 * 30_000 - 3 * 30_000);
      assert.equal(await gl(tx, SYS.INVENTORY), await totalStockValueCents(tx));
      assert.equal(await trial(tx), 0);
    });
  }));

test("stock take: blind count, sale during count, owner approval", () =>
  inRollback(async (tx) => {
    const date = "2026-09-29";
    await markBaseline(tx);
    await as("owner", async () => {
      const [brand] = await tx.insert(brands).values({ orgId: org.id, name: "TEST Brand" }).returning();
      const a = await variantOf(tx, "TEST Shampoo", brand.id, 10, 2_000);
      const b = await variantOf(tx, "TEST Conditioner", brand.id, 5, 3_000);
      const c = await variantOf(tx, "TEST Relaxer", brand.id, 8, 6_500);
      const other = await variantOf(tx, "TEST Out of scope", null, 4, 1_000);

      const id = await as("staff", () => startStockTake(tx, { brandIds: [brand.id] }));
      const [take] = await tx.select().from(stockTakes).where(eq(stockTakes.id, id));
      assert.equal(take.scopeLabel, "TEST Brand");
      assert.equal((await tx.select().from(stockTakeLines).where(eq(stockTakeLines.stockTakeId, id))).length, 3);
      await assert.rejects(as("staff", () => startStockTake(tx, { all: true })), /already in progress/);

      await as("staff", async () => {
        // Shampoo: scanned 7 times → 3 missing
        for (let i = 0; i < 7; i++) await recordCount(tx, { stockTakeId: id, variantId: a, qty: 1, mode: "add" });
        // Conditioner: counted 5 → matches
        await recordCount(tx, { stockTakeId: id, variantId: b, qty: 5, mode: "set" });
        // Found stock outside the scope → added to the count, 1 extra
        await recordCount(tx, { stockTakeId: id, variantId: other, qty: 5, mode: "set" });
        // Relaxer is never counted → left alone
      });

      // A sale of 2 shampoos AFTER the shampoo was counted must not be double-corrected
      const sold = await removeStock(tx, { variantId: a, qty: 2, date, sourceType: "sale" });
      await postEntry(tx, { date, sourceType: "test_sale", lines: [
        { accountId: await acct(tx, SYS.COGS), debitCents: sold.costCents },
        { accountId: await acct(tx, SYS.INVENTORY), creditCents: sold.costCents },
      ] });

      await as("staff", () => submitStockTake(tx, id));
      await assert.rejects(as("staff", () => recordCount(tx, { stockTakeId: id, variantId: b, qty: 1, mode: "set" })), /submitted/);
      await assert.rejects(as("staff", () => approveStockTake(tx, id, date)), /Only the owner/);

      const review = await reviewStockTake(tx, id);
      const shampoo = review.find((r) => r.variantId === a)!;
      assert.equal(shampoo.differenceQty, -3);
      assert.equal(shampoo.differenceCents, -6_000);
      assert.equal(review.find((r) => r.variantId === c)!.countedQty, null);

      const res = await approveStockTake(tx, id, date);
      assert.equal(res.varianceCostCents, -3 * 2_000 + 1 * 1_000);
      assert.equal((await onHand(tx, a)).qty, 10 - 2 - 3); // sold 2, 3 missing
      assert.equal((await onHand(tx, b)).qty, 5);
      assert.equal((await onHand(tx, c)).qty, 8); // uncounted, untouched
      assert.equal((await onHand(tx, other)).qty, 5);
      assert.equal(await moved(tx, SYS.STOCK_LOSS), 5_000);
      assert.equal(await gl(tx, SYS.INVENTORY), await totalStockValueCents(tx));
      assert.equal(await trial(tx), 0);
    });
  }));

after(async () => { await db.$client.end(); });
