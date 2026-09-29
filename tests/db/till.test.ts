import { test, after } from "node:test";
import assert from "node:assert/strict";
import { loadEnv } from "../../scripts/env";
loadEnv();

const { db, orgs, products, variants, suppliers, registers, customers, journalLines, accounts, bills, sales, salePayments } = await import("../../src/db");
const { eq, and, sql } = await import("drizzle-orm");
const { runWithOrg } = await import("../../src/lib/context");
const { postBill, postSupplierPayment } = await import("../../src/lib/purchasing");
const { checkout, CheckoutError } = await import("../../src/lib/checkout");
const { openShift } = await import("../../src/lib/shifts");
const { onHand, totalStockValueCents } = await import("../../src/lib/inventory");
const { SYS } = await import("../../src/lib/coa");

const [org] = await db.select().from(orgs).where(eq(orgs.slug, "kenfri")).limit(1);
const [realRegister] = await db.select().from(registers).where(eq(registers.orgId, org.id)).limit(1);
/** Each test sells on its own throwaway till, so a real open shift on Till 1 doesn't interfere. */
let register: typeof realRegister;
async function testRegister(tx: any) {
  [register] = await tx.insert(registers).values({ orgId: org.id, locationId: realRegister.locationId, name: "TEST till" }).returning();
}
const as = <T>(role: "owner" | "cashier", fn: () => Promise<T>) => runWithOrg({ orgId: org.id, memberId: 999_001, role }, fn);

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

/** Lush invoice fixture: leave-in (25.00) and relaxer twin pack (65.00), VAT-inclusive rates. */
async function fixture(tx: any) {
  const [sup] = await tx.insert(suppliers).values({ orgId: org.id, name: "TEST Tolaram" }).returning();
  const mk = async (name: string, retail: number, wholesale: number) => {
    const [p] = await tx.insert(products).values({ orgId: org.id, name }).returning();
    const [v] = await tx.insert(variants).values({ orgId: org.id, productId: p.id, retailPriceCents: retail, wholesalePriceCents: wholesale }).returning();
    return v.id as number;
  };
  const leaveIn = await mk("TEST Leave-in 40g", 5_000, 4_000);
  const relaxer = await mk("TEST Relaxer twin 45g", 12_000, 10_000);
  const [retail] = await tx.insert(customers).values({ orgId: org.id, phone: "254700000001", name: "Test Retail" }).returning();
  const [salon] = await tx.insert(customers).values({ orgId: org.id, phone: "254700000002", name: "Test Salon", type: "wholesale", creditEnabled: true, creditLimitCents: 50_000 }).returning();
  return { sup: sup.id as number, leaveIn, relaxer, retail: retail.id as number, salon: salon.id as number };
}

test("bill → sale → supplier payment keeps the books balanced", () =>
  as("owner", () => inRollback(async (tx) => {
    await testRegister(tx);
    await markBaseline(tx);
    const f = await fixture(tx);
    const date = "2026-09-25";
    const bill = await postBill(tx, {
      supplierId: f.sup, supplierInvoiceNo: "WBNSAL-TEST-1", invoiceDate: date, dueDate: date, ratesIncludeVat: true, vatBp: 1600,
      lines: [
        { variantId: f.leaveIn, supplierItemCode: "FGWHDLIT01-40", qty: 48, unitsPerUom: 1, rateCents: 2_500 },
        { variantId: f.relaxer, supplierItemCode: "FGRLXTP01-45", qty: 48, unitsPerUom: 1, rateCents: 6_500 },
      ],
    });
    assert.equal(bill.totalCents, 432_000);
    const [b] = await tx.select().from(bills).where(eq(bills.id, bill.billId));
    assert.equal(b.netCents + b.vatCents, 432_000);
    assert.equal(await moved(tx, SYS.AP), -432_000);
    await assert.rejects(
      postBill(tx, { supplierId: f.sup, supplierInvoiceNo: "WBNSAL-TEST-1", invoiceDate: date, dueDate: date, ratesIncludeVat: true, vatBp: 1600, lines: [{ variantId: f.leaveIn, qty: 1, unitsPerUom: 1, rateCents: 100 }] }),
      /already recorded/
    );

    await openShift(tx, { registerId: register.id, openingFloatCents: 200_000, date });

    // Retail: 3 leave-in + 1 relaxer = 270.00, KES 20 off, paid 100 cash (handed 500) + 150 M-Pesa
    const sale = await checkout(tx, {
      idempotencyKey: "test-sale-1", registerId: register.id, customerId: f.retail, businessDate: date,
      lines: [{ variantId: f.leaveIn, qty: 3, manualDiscountCents: 0 }, { variantId: f.relaxer, qty: 1, manualDiscountCents: 0 }],
      cartDiscountCents: 2_000,
      payments: [{ method: "cash", amountCents: 10_000, tenderedCents: 50_000 }, { method: "mpesa", amountCents: 15_000, mpesaCode: "sjk4h7qx2m" }],
    });
    assert.equal(sale.totalCents, 25_000);
    assert.equal(sale.changeCents, 40_000);
    assert.match(sale.receiptNo, /^KF-\d{6}$/);

    // Replaying the same key returns the same sale, no double posting
    const again = await checkout(tx, {
      idempotencyKey: "test-sale-1", registerId: register.id, customerId: f.retail, businessDate: date,
      lines: [{ variantId: f.leaveIn, qty: 3, manualDiscountCents: 0 }], cartDiscountCents: 0, payments: [{ method: "cash", amountCents: 1 }],
    });
    assert.equal(again.saleId, sale.saleId);
    assert.equal(again.replayed, true);

    // Wholesale on credit: 10 relaxers at 100.00 = 1,000 > 500 limit → refused for cashier, fine for 4
    const salonSale = await checkout(tx, {
      idempotencyKey: "test-sale-2", registerId: register.id, customerId: f.salon, businessDate: date,
      lines: [{ variantId: f.relaxer, qty: 4, manualDiscountCents: 0 }], cartDiscountCents: 0,
      payments: [{ method: "credit", amountCents: 40_000 }],
    });
    assert.equal(salonSale.totalCents, 40_000);

    assert.deepEqual(await onHand(tx, f.leaveIn), { qty: 45, valueCents: 45 * 2_500 });
    assert.deepEqual(await onHand(tx, f.relaxer), { qty: 43, valueCents: 43 * 6_500 });
    assert.equal(await moved(tx, SYS.CASH_DRAWER), 200_000 + 10_000);
    assert.equal(await moved(tx, SYS.MPESA_TILL), 15_000);
    assert.equal(await moved(tx, SYS.AR), 40_000);
    assert.equal(await moved(tx, SYS.MANUAL_DISCOUNTS), 2_000);
    assert.equal(await moved(tx, SYS.COGS), 3 * 2_500 + 6_500 + 4 * 6_500);

    // Pay the supplier 1,000 by M-Pesa
    await postSupplierPayment(tx, { supplierId: f.sup, date, amountCents: 100_000, method: "mpesa", reference: "QWE123" });
    const [paid] = await tx.select().from(bills).where(eq(bills.id, bill.billId));
    assert.equal(paid.paidCents, 100_000);

    assert.equal(await gl(tx, SYS.INVENTORY), await totalStockValueCents(tx));
    assert.equal(await trial(tx), 0);
  })));

test("till rules: price level, M-Pesa reuse, credit limit, discount limit", () =>
  as("cashier", () => inRollback(async (tx) => {
    await testRegister(tx);
    await markBaseline(tx);
    const f = await fixture(tx);
    const date = "2026-09-25";
    await openShift(tx, { registerId: register.id, openingFloatCents: 0, date });
    const base = { registerId: register.id, businessDate: date, cartDiscountCents: 0 };

    await checkout(tx, { ...base, idempotencyKey: "r1", customerId: f.retail, lines: [{ variantId: f.leaveIn, qty: 1, manualDiscountCents: 0 }], payments: [{ method: "mpesa", amountCents: 5_000, mpesaCode: "ABCDE12345" }] });
    await assert.rejects(
      checkout(tx, { ...base, idempotencyKey: "r2", customerId: f.retail, lines: [{ variantId: f.leaveIn, qty: 1, manualDiscountCents: 0 }], payments: [{ method: "mpesa", amountCents: 5_000, mpesaCode: "abcde12345" }] }),
      /already used/
    );
    // Wholesale price applies to the salon (40.00, not 50.00)
    const w = await checkout(tx, { ...base, idempotencyKey: "w1", customerId: f.salon, lines: [{ variantId: f.leaveIn, qty: 1, manualDiscountCents: 0 }], payments: [{ method: "cash", amountCents: 4_000 }] });
    assert.equal(w.totalCents, 4_000);
    // Credit beyond the 500 limit is refused for a cashier
    await assert.rejects(
      checkout(tx, { ...base, idempotencyKey: "c1", customerId: f.salon, lines: [{ variantId: f.relaxer, qty: 6, manualDiscountCents: 0 }], payments: [{ method: "credit", amountCents: 60_000 }] }),
      /credit is available/
    );
    // Retail customer has no credit account
    await assert.rejects(
      checkout(tx, { ...base, idempotencyKey: "c2", customerId: f.retail, lines: [{ variantId: f.leaveIn, qty: 1, manualDiscountCents: 0 }], payments: [{ method: "credit", amountCents: 5_000 }] }),
      /doesn't have a credit account/
    );
    // Cashier discount above KES 500 needs the owner
    await assert.rejects(
      checkout(tx, { ...base, idempotencyKey: "d1", customerId: f.retail, lines: [{ variantId: f.relaxer, qty: 10, manualDiscountCents: 50_100 }], payments: [{ method: "cash", amountCents: 69_900 }] }),
      /need the owner's PIN/
    );
    // Payments must match the total
    await assert.rejects(
      checkout(tx, { ...base, idempotencyKey: "p1", customerId: f.retail, lines: [{ variantId: f.leaveIn, qty: 1, manualDiscountCents: 0 }], payments: [{ method: "cash", amountCents: 4_900 }] }),
      CheckoutError
    );
    assert.equal(await trial(tx), 0);
  })));

after(async () => { await db.$client.end(); });
