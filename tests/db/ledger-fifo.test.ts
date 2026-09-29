import { test, after } from "node:test";
import assert from "node:assert/strict";
import { loadEnv } from "../../scripts/env";
loadEnv();

const { db, orgs, products, variants, journalLines, accounts } = await import("../../src/db");
const { eq, and, sql } = await import("drizzle-orm");
const { runWithOrg } = await import("../../src/lib/context");
const { postOpeningStock, recordStockAdjustment } = await import("../../src/lib/stock-postings");
const { removeStock, addStock, onHand, totalStockValueCents } = await import("../../src/lib/inventory");
const { acct, postEntry, UnbalancedEntryError, BooksLockedError } = await import("../../src/lib/ledger");
const { SYS } = await import("../../src/lib/coa");

const [org] = await db.select().from(orgs).where(eq(orgs.slug, "kenfri")).limit(1);
const asOwner = <T>(fn: () => Promise<T>) => runWithOrg({ orgId: org.id, memberId: null, role: "owner" }, fn);

class Rollback extends Error {}
/** Runs fn in a transaction that is always rolled back. */
async function inRollback(fn: (tx: any) => Promise<void>) {
  await assert.rejects(
    db.transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    }),
    Rollback
  );
}

async function glBalance(tx: any, code: string) {
  const [row] = await tx
    .select({ bal: sql<string>`coalesce(sum(${journalLines.debitCents} - ${journalLines.creditCents}), 0)` })
    .from(journalLines)
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .where(and(eq(journalLines.orgId, org.id), eq(accounts.code, code)));
  return Number(row.bal);
}

async function trialBalance(tx: any) {
  const [row] = await tx
    .select({ d: sql<string>`coalesce(sum(${journalLines.debitCents}),0)`, c: sql<string>`coalesce(sum(${journalLines.creditCents}),0)` })
    .from(journalLines)
    .where(eq(journalLines.orgId, org.id));
  return Number(row.d) - Number(row.c);
}

async function makeVariant(tx: any) {
  const [p] = await tx.insert(products).values({ orgId: org.id, name: "TEST Leave-in 40g" }).returning();
  const [v] = await tx.insert(variants).values({ orgId: org.id, productId: p.id, retailPriceCents: 5000 }).returning();
  return v.id as number;
}

test("FIFO + deficit settlement keeps stock value equal to Inventory GL", () =>
  asOwner(() =>
    inRollback(async (tx) => {
      const v = await makeVariant(tx);
      const date = "2026-09-24";
      // 10 units at KES 25.00 (Lush VAT-inclusive cost), then 5 at KES 27.00
      await postOpeningStock(tx, { variantId: v, qty: 10, totalCostCents: 25_000, date });
      await postOpeningStock(tx, { variantId: v, qty: 5, totalCostCents: 13_500, date });

      // Sell 17: 10@25 + 5@27 + 2 oversold, estimated at last cost 27
      const sale = await removeStock(tx, { variantId: v, qty: 17, date, sourceType: "sale" });
      assert.equal(sale.shortfallQty, 2);
      assert.equal(sale.costCents, 25_000 + 13_500 + 5_400);
      const inv = await acct(tx, SYS.INVENTORY);
      await postEntry(tx, { date, sourceType: "test_sale", lines: [
        { accountId: await acct(tx, SYS.COGS), debitCents: sale.costCents },
        { accountId: inv, creditCents: sale.costCents },
      ] });
      assert.deepEqual(await onHand(tx, v), { qty: -2, valueCents: -5_400 });

      // Stock arrives at KES 30.00: settles 2 (variance 2×(30−27)=600) and leaves 22
      const recv = await addStock(tx, { variantId: v, qty: 24, totalCostCents: 72_000, date, sourceType: "bill" });
      assert.equal(recv.deficitVarianceCents, 600);
      await postEntry(tx, { date, sourceType: "test_bill", lines: [
        { accountId: inv, debitCents: 72_000 },
        { accountId: await acct(tx, SYS.AP), creditCents: 72_000 },
        { accountId: await acct(tx, SYS.COGS), debitCents: 600 },
        { accountId: inv, creditCents: 600 },
      ] });
      assert.deepEqual(await onHand(tx, v), { qty: 22, valueCents: 66_000 });

      // Damaged: 3 units out at FIFO cost
      await recordStockAdjustment(tx, { variantId: v, qtyDelta: -3, reason: "damaged", date });
      assert.deepEqual(await onHand(tx, v), { qty: 19, valueCents: 57_000 });

      assert.equal(await glBalance(tx, SYS.INVENTORY), await totalStockValueCents(tx));
      assert.equal(await trialBalance(tx), 0);
    })
  ));

test("unbalanced and negative entries are refused", () =>
  asOwner(() =>
    inRollback(async (tx) => {
      const cash = await acct(tx, SYS.CASH_DRAWER);
      const sales = await acct(tx, SYS.SALES_RETAIL);
      await assert.rejects(
        postEntry(tx, { date: "2026-09-24", sourceType: "t", lines: [{ accountId: cash, debitCents: 100 }, { accountId: sales, creditCents: 99 }] }),
        UnbalancedEntryError
      );
      await assert.rejects(
        postEntry(tx, { date: "2026-09-24", sourceType: "t", lines: [{ accountId: cash, debitCents: -5 }, { accountId: sales, creditCents: -5 }] }),
        UnbalancedEntryError
      );
    })
  ));

test("period lock blocks back-dated postings", () =>
  asOwner(() =>
    inRollback(async (tx) => {
      await tx.update(orgs).set({ lockDate: "2026-08-31" }).where(eq(orgs.id, org.id));
      const cash = await acct(tx, SYS.CASH_DRAWER);
      const sales = await acct(tx, SYS.SALES_RETAIL);
      const lines = [{ accountId: cash, debitCents: 100 }, { accountId: sales, creditCents: 100 }];
      await assert.rejects(postEntry(tx, { date: "2026-08-31", sourceType: "t", lines }), BooksLockedError);
      await postEntry(tx, { date: "2026-09-01", sourceType: "t", lines });
    })
  ));

after(async () => { await db.$client.end(); });
