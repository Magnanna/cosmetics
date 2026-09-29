import { test, after } from "node:test";
import assert from "node:assert/strict";
import { loadEnv } from "../../scripts/env";
loadEnv();

const { db, orgs, products, variants, brands, registers, customers, journalLines, accounts, offers, offerTargets, saleLines, saleReturns, loyaltyLedger } = await import("../../src/db");
const { eq, and, sql } = await import("drizzle-orm");
const { runWithOrg } = await import("../../src/lib/context");
const { checkout } = await import("../../src/lib/checkout");
const { openShift } = await import("../../src/lib/shifts");
const { postOpeningStock } = await import("../../src/lib/stock-postings");
const { processReturn, refundExchangeCredit } = await import("../../src/lib/returns");
const { recordCashMovement, closeShift, shiftSummary } = await import("../../src/lib/cashup");
const { receiveCustomerPayment, customerStatement } = await import("../../src/lib/credit");
const { onHand, totalStockValueCents } = await import("../../src/lib/inventory");
const { SYS } = await import("../../src/lib/coa");

const [org] = await db.select().from(orgs).where(eq(orgs.slug, "kenfri")).limit(1);
const [realRegister] = await db.select().from(registers).where(eq(registers.orgId, org.id)).limit(1);
const as = <T>(role: "owner" | "cashier", fn: () => Promise<T>) => runWithOrg({ orgId: org.id, memberId: 999_004, role }, fn);

class Rollback extends Error {}
async function inRollback(fn: (tx: any) => Promise<void>) {
  await assert.rejects(db.transaction(async (tx) => { await fn(tx); throw new Rollback(); }), Rollback);
}
let baseline = new Map<string, number>();
async function balances(tx: any) {
  const rows = await tx.select({ code: accounts.code, b: sql<string>`coalesce(sum(${journalLines.debitCents} - ${journalLines.creditCents}),0)` })
    .from(journalLines).innerJoin(accounts, eq(journalLines.accountId, accounts.id)).where(eq(journalLines.orgId, org.id)).groupBy(accounts.code);
  return new Map<string, number>(rows.map((r: any) => [r.code, Number(r.b)]));
}
async function moved(tx: any, code: string) { return ((await balances(tx)).get(code) ?? 0) - (baseline.get(code) ?? 0); }
async function trial(tx: any) {
  const [r] = await tx.select({ d: sql<string>`coalesce(sum(${journalLines.debitCents}),0)`, c: sql<string>`coalesce(sum(${journalLines.creditCents}),0)` }).from(journalLines).where(eq(journalLines.orgId, org.id));
  return Number(r.d) - Number(r.c);
}

const now = new Date();
const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(now);

async function setup(tx: any) {
  // A throwaway till; if a real shift is open it stays untouched (the drawer is compared by movement).
  const [register] = await tx.insert(registers).values({ orgId: org.id, locationId: realRegister.locationId, name: "TEST till 3" }).returning();
  const [brand] = await tx.insert(brands).values({ orgId: org.id, name: "TEST Lips Co" }).returning();
  const mk = async (name: string, brandId: number | null, retail: number, cost: number) => {
    const [p] = await tx.insert(products).values({ orgId: org.id, name, brandId }).returning();
    const [v] = await tx.insert(variants).values({ orgId: org.id, productId: p.id, retailPriceCents: retail, wholesalePriceCents: retail - 1_000 }).returning();
    await postOpeningStock(tx, { variantId: v.id, qty: 20, totalCostCents: 20 * cost, date });
    return v.id as number;
  };
  const lipstick = await mk("TEST Lipstick", brand.id, 65_000, 30_000);
  const lotion = await mk("TEST Lotion", null, 50_000, 25_000);
  const [ann] = await tx.insert(customers).values({ orgId: org.id, phone: "254700000031", name: "Ann", pointsBalance: 150_000 }).returning(); // 1,500 pts = KES 150
  const [salon] = await tx.insert(customers).values({ orgId: org.id, phone: "254700000032", name: "Salon", type: "wholesale", creditEnabled: true, creditLimitCents: 500_000 }).returning();
  // 20% off the brand, live now
  const [off] = await tx.insert(offers).values({ orgId: org.id, title: "Lips 20% off", type: "percent_off", value: 2000, startsAt: new Date(now.getTime() - 86_400_000), endsAt: new Date(now.getTime() + 7 * 86_400_000) }).returning();
  await tx.insert(offerTargets).values({ orgId: org.id, offerId: off.id, kind: "brand", targetId: brand.id });
  baseline = await balances(tx);
  const shiftId = await openShift(tx, { registerId: register.id, openingFloatCents: 100_000, date });
  return { register, lipstick, lotion, ann: ann.id as number, salon: salon.id as number, shiftId };
}

test("offers, points earn/redeem, exchange, refund, cash-up, credit — books stay balanced", () =>
  inRollback(async (tx) => {
    const f = await as("owner", () => setup(tx));
    await as("cashier", async () => {
      // Lipstick 650 → 520 with the offer; lotion 500. Total 1,020. Pay 150 with points, 870 cash (1,000 handed).
      const sale = await checkout(tx, {
        idempotencyKey: "w3-1", registerId: f.register.id, customerId: f.ann, businessDate: date, now,
        lines: [{ variantId: f.lipstick, qty: 1, manualDiscountCents: 0 }, { variantId: f.lotion, qty: 1, manualDiscountCents: 0 }],
        cartDiscountCents: 0,
        payments: [{ method: "points", amountCents: 15_000 }, { method: "cash", amountCents: 87_000, tenderedCents: 100_000 }],
      });
      assert.equal(sale.totalCents, 102_000);
      assert.equal(sale.changeCents, 13_000);
      // Earned on the 870 actually paid in cash: 87 pts
      assert.equal(sale.pointsEarned, 8_700);
      assert.equal(sale.pointsBalance, 150_000 - 150_000 + 8_700);
      const lines = await tx.select().from(saleLines).where(eq(saleLines.saleId, sale.saleId));
      assert.equal(lines.find((l: any) => l.variantId === f.lipstick).promoDiscountCents, 13_000);
      assert.equal(await moved(tx, SYS.PROMO_DISCOUNTS), 13_000);
      assert.equal(await moved(tx, SYS.LOYALTY_LIABILITY), -870 + 15_000); // earned value 8.70 credited, 150 redeemed debited

      // Points can't be used below the KES 100 minimum
      await assert.rejects(checkout(tx, {
        idempotencyKey: "w3-2", registerId: f.register.id, customerId: f.ann, businessDate: date, now,
        lines: [{ variantId: f.lotion, qty: 1, manualDiscountCents: 0 }], cartDiscountCents: 0, payments: [{ method: "points", amountCents: 500 }],
      }), /once they're worth KES 100/);

      // Exchange the lotion (unopened) → credit 500, spent on a lipstick (520) + 20 cash
      const lotionLine = lines.find((l: any) => l.variantId === f.lotion);
      await assert.rejects(processReturn(tx, { idempotencyKey: "r-0", saleId: sale.saleId, registerId: f.register.id, kind: "exchange", lines: [{ saleLineId: lotionLine.id, qty: 1 }], unopenedConfirmed: false, businessDate: date, now }), /unopened/);
      await assert.rejects(processReturn(tx, { idempotencyKey: "r-1", saleId: sale.saleId, registerId: f.register.id, kind: "refund", refundMethod: "cash", lines: [{ saleLineId: lotionLine.id, qty: 1 }], unopenedConfirmed: true, businessDate: date, now }), /owner's PIN/);
      const ex = await processReturn(tx, { idempotencyKey: "r-2", saleId: sale.saleId, registerId: f.register.id, kind: "exchange", lines: [{ saleLineId: lotionLine.id, qty: 1 }], unopenedConfirmed: true, businessDate: date, now });
      assert.equal(ex.creditCents, 50_000);
      assert.equal((await onHand(tx, f.lotion)).qty, 20);
      // Points on the returned share were taken back: 8,700 × 500/1,020 = 4,264
      const [rev] = await tx.select().from(loyaltyLedger).where(and(eq(loyaltyLedger.returnId, ex.returnId), eq(loyaltyLedger.kind, "reverse")));
      assert.equal(rev.points, -4_264);

      const swap = await checkout(tx, {
        idempotencyKey: "w3-3", registerId: f.register.id, customerId: f.ann, businessDate: date, now,
        lines: [{ variantId: f.lipstick, qty: 1, manualDiscountCents: 0 }], cartDiscountCents: 0,
        payments: [{ method: "exchange", amountCents: 50_000, returnId: ex.returnId }, { method: "cash", amountCents: 2_000 }],
      });
      assert.equal(swap.totalCents, 52_000);
      const [after] = await tx.select().from(saleReturns).where(eq(saleReturns.id, ex.returnId));
      assert.equal(after.creditLeftCents, 0);
      assert.equal(await moved(tx, SYS.EXCHANGE_CREDIT), 0);
      await assert.rejects(refundExchangeCredit(tx, { returnId: ex.returnId, method: "cash", date }), /owner's PIN/);

      // Late return is refused without the owner
      await assert.rejects(processReturn(tx, { idempotencyKey: "r-3", saleId: swap.saleId, registerId: f.register.id, kind: "exchange", lines: [{ saleLineId: (await tx.select().from(saleLines).where(eq(saleLines.saleId, swap.saleId)))[0].id, qty: 1 }], unopenedConfirmed: true, businessDate: date, now: new Date(now.getTime() + 30 * 3_600_000) }), /older than 24 hours/);

      // Salon buys 4 at the wholesale price (490) on account, pays half later at the till in cash
      await checkout(tx, {
        idempotencyKey: "w3-4", registerId: f.register.id, customerId: f.salon, businessDate: date, now,
        lines: [{ variantId: f.lotion, qty: 4, manualDiscountCents: 0 }], cartDiscountCents: 0, payments: [{ method: "credit", amountCents: 196_000 }],
      });
      await receiveCustomerPayment(tx, { customerId: f.salon, amountCents: 98_000, method: "cash", shiftId: f.shiftId, date });
      await assert.rejects(receiveCustomerPayment(tx, { customerId: f.salon, amountCents: 100_000, method: "cash", shiftId: f.shiftId, date }), /only owe/);
      const st = await customerStatement(tx, f.salon, "2026-01-01", date);
      assert.equal(st.closingCents, 98_000);
      assert.equal(st.lines.length, 2);

      // Cash out for transport; the owner takes 200
      await recordCashMovement(tx, { shiftId: f.shiftId, reason: "petty_expense", amountCents: 30_000, note: "Boda to supplier", expenseAccountCode: "6030", date });
      await recordCashMovement(tx, { shiftId: f.shiftId, reason: "owner_drawing", amountCents: 20_000, date });

      // Drawer: float 1,000 + 870 + 20 + 980 − 300 − 200 = 2,370
      const summary = await shiftSummary(tx, f.shiftId);
      assert.equal(summary.expectedCashCents - (baseline.get(SYS.CASH_DRAWER) ?? 0), 237_000);
      assert.equal(summary.saleCount, 3);
      assert.equal(summary.byTender.points, 15_000);

      // Blind count comes up KES 50 short
      const realDrawer = baseline.get(SYS.CASH_DRAWER) ?? 0;
      const counts: Record<number, number> = { 100_000: 2, 10_000: 3, 2_000: 1 }; // 2,000 + 300 + 20 = 2,320
      if (realDrawer) counts[100] = realDrawer / 100; // any real shift's drawer money, counted in KES 1 coins
      const z = await closeShift(tx, { shiftId: f.shiftId, counts, date });
      assert.equal(z.varianceCents, -5_000);
      assert.equal(await moved(tx, SYS.CASH_OVER_SHORT), 5_000);
      assert.equal(await moved(tx, SYS.CASH_DRAWER), -(baseline.get(SYS.CASH_DRAWER) ?? 0));
    });
    assert.equal((await balances(tx)).get(SYS.INVENTORY), await as("owner", () => totalStockValueCents(tx)));
    assert.equal(await trial(tx), 0);
  }));

after(async () => { await db.$client.end(); });
