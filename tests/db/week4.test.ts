import { test, after } from "node:test";
import assert from "node:assert/strict";
import { loadEnv } from "../../scripts/env";
loadEnv();

const { db, orgs, products, variants, registers, customers, suppliers, accounts, bills } = await import("../../src/db");
const { eq, and } = await import("drizzle-orm");
const { runWithOrg } = await import("../../src/lib/context");
const { checkout } = await import("../../src/lib/checkout");
const { openShift } = await import("../../src/lib/shifts");
const { postOpeningStock } = await import("../../src/lib/stock-postings");
const { profitAndLoss, balanceSheet, trialBalance, totForMonth, accountLedger } = await import("../../src/lib/reports");
const { recordExpense, transferMoney, postTurnoverTax, payTurnoverTax, manualJournal } = await import("../../src/lib/money-ops");
const { openingMoney, openingSupplierDebt, openingCustomerDebt } = await import("../../src/lib/opening");
const { postSupplierPayment } = await import("../../src/lib/purchasing");
const { importStatement, missingFromStatement } = await import("../../src/lib/mpesa-reconcile");
const { SYS } = await import("../../src/lib/coa");

const [org] = await db.select().from(orgs).where(eq(orgs.slug, "kenfri")).limit(1);
const [realRegister] = await db.select().from(registers).where(eq(registers.orgId, org.id)).limit(1);
const as = <T>(role: "owner" | "accountant", fn: () => Promise<T>) => runWithOrg({ orgId: org.id, memberId: 999_005, role }, fn);

class Rollback extends Error {}
async function inRollback(fn: (tx: any) => Promise<void>) {
  await assert.rejects(db.transaction(async (tx) => { await fn(tx); throw new Rollback(); }), Rollback);
}
const acctId = async (tx: any, code: string) => (await tx.select().from(accounts).where(and(eq(accounts.orgId, org.id), eq(accounts.code, code))))[0].id as number;

// A month far in the future so real shop data can't mix into the report figures.
const month = "2031-03";
const d = (day: number) => `${month}-${String(day).padStart(2, "0")}`;

test("reports, Turnover Tax, expenses, transfers, journals, opening balances, M-Pesa reconcile", () =>
  as("owner", () => inRollback(async (tx) => {
    const [register] = await tx.insert(registers).values({ orgId: org.id, locationId: realRegister.locationId, name: "TEST till 4" }).returning();
    const [p] = await tx.insert(products).values({ orgId: org.id, name: "TEST Serum" }).returning();
    const [v] = await tx.insert(variants).values({ orgId: org.id, productId: p.id, retailPriceCents: 100_000 }).returning();
    await postOpeningStock(tx, { variantId: v.id, qty: 50, totalCostCents: 50 * 40_000, date: d(1) });
    const [cust] = await tx.insert(customers).values({ orgId: org.id, phone: "254700000041", name: "Wanjiku", type: "wholesale", creditEnabled: true, creditLimitCents: 10_000_000 }).returning();
    const [sup] = await tx.insert(suppliers).values({ orgId: org.id, name: "TEST Supplier 4" }).returning();

    // Go-live balances
    await openingMoney(tx, { date: d(1), account: "bank", amountCents: 5_000_000 });
    await openingMoney(tx, { date: d(1), account: "cash_at_hand", amountCents: 200_000 });
    const oldBill = await openingSupplierDebt(tx, { date: d(1), supplierId: sup.id, amountCents: 300_000, reference: "Old invoice 77" });
    await openingCustomerDebt(tx, { date: d(1), customerId: cust.id, amountCents: 150_000 });
    await postSupplierPayment(tx, { supplierId: sup.id, date: d(2), amountCents: 300_000, method: "bank" });
    const [paidBill] = await tx.select().from(bills).where(eq(bills.id, oldBill));
    assert.equal(paidBill.paidCents, 300_000);

    // Sell 10 serums (10,000) with M-Pesa code, no float
    await openShift(tx, { registerId: register.id, openingFloatCents: 0, date: d(5) });
    await checkout(tx, {
      idempotencyKey: "w4-1", registerId: register.id, customerId: cust.id, businessDate: d(5),
      lines: [{ variantId: v.id, qty: 10, manualDiscountCents: 0 }], cartDiscountCents: 50_000,
      payments: [{ method: "mpesa", amountCents: 950_000, mpesaCode: "TST4W4AAA1" }],
    });

    // Rent 15,000 from the bank; move 1,500 cash at hand to the bank
    await recordExpense(tx, { date: d(6), accountId: await acctId(tx, "6000"), amountCents: 1_500_000, paidFrom: "bank", description: "March rent" });
    await transferMoney(tx, { date: d(6), from: "cash_at_hand", to: "bank", amountCents: 150_000, feeCents: 0 });
    await assert.rejects(transferMoney(tx, { date: d(6), from: "bank", to: "bank", amountCents: 1 }), /two different/);

    // Accountant journal: owner put in 1,000 more capital — but may not touch system accounts
    const bankId = await acctId(tx, SYS.BANK);
    const equityId = await acctId(tx, SYS.OWNER_EQUITY);
    await as("accountant", () => manualJournal(tx, { date: d(7), memo: "Capital injection", lines: [{ accountId: bankId, debitCents: 100_000, creditCents: 0 }, { accountId: equityId, debitCents: 0, creditCents: 100_000 }] }));
    await assert.rejects(manualJournal(tx, { date: d(7), memo: "x", lines: [{ accountId: await acctId(tx, SYS.INVENTORY), debitCents: 1, creditCents: 0 }, { accountId: await acctId(tx, SYS.BANK), debitCents: 0, creditCents: 1 }] }), /kept by the system/);

    // P&L for the month: sales 10,000 − 500 discount = 9,500; cost 4,000; rent 15,000
    const pnl = await profitAndLoss(tx, d(1), d(31));
    assert.equal(pnl.netSalesCents, 950_000);
    assert.equal(pnl.costOfSales.totalCents, 400_000);
    assert.equal(pnl.grossProfitCents, 550_000);
    assert.equal(pnl.expenses.totalCents, 1_500_000);
    assert.equal(pnl.netProfitCents, -950_000);

    // Turnover Tax: 1.5% of 9,500 = 142.50, record once, pay from M-Pesa
    const tot = await totForMonth(tx, month);
    assert.equal(tot.turnoverCents, 950_000);
    assert.equal(tot.taxCents, 14_250);
    assert.equal(tot.dueDate, "2031-04-20");
    await postTurnoverTax(tx, month);
    await assert.rejects(postTurnoverTax(tx, month), /already recorded/);
    await payTurnoverTax(tx, { month, date: "2031-04-18", amountCents: 14_250, paidFrom: "mpesa" });
    const after = await totForMonth(tx, month);
    assert.equal(after.paidCents, 14_250);
    assert.equal((await profitAndLoss(tx, d(1), d(31))).netProfitCents, -950_000 - 14_250);

    // Whole books still balance
    const bs = await balanceSheet(tx, "2031-04-30");
    assert.ok(bs.balanced, "balance sheet balances");
    assert.ok((await trialBalance(tx, "2031-04-30")).balanced);
    const bank = await accountLedger(tx, await acctId(tx, SYS.BANK), d(1), d(31));
    assert.equal(bank!.closingCents - bank!.openingCents, 5_000_000 - 300_000 - 1_500_000 + 150_000 + 100_000);

    // M-Pesa statement: one match, one wrong amount, one unrecorded, one withdrawal; one till code missing
    await checkout(tx, {
      idempotencyKey: "w4-2", registerId: register.id, customerId: cust.id, businessDate: d(8),
      lines: [{ variantId: v.id, qty: 1, manualDiscountCents: 0 }], cartDiscountCents: 0,
      payments: [{ method: "mpesa", amountCents: 100_000, mpesaCode: "TST4W4BBB2" }],
    });
    await checkout(tx, {
      idempotencyKey: "w4-3", registerId: register.id, customerId: cust.id, businessDate: d(8),
      lines: [{ variantId: v.id, qty: 1, manualDiscountCents: 0 }], cartDiscountCents: 0,
      payments: [{ method: "mpesa", amountCents: 100_000, mpesaCode: "TST4W4CCC3" }],
    });
    const res = await importStatement(tx, "statement.csv", [
      { code: "TST4W4AAA1", completedAt: `${d(5)} 10:00:00`, details: "", paidInCents: 950_000, withdrawnCents: 0 },
      { code: "TST4W4BBB2", completedAt: `${d(8)} 10:00:00`, details: "", paidInCents: 90_000, withdrawnCents: 0 },
      { code: "TST4W4ZZZ9", completedAt: `${d(8)} 11:00:00`, details: "", paidInCents: 20_000, withdrawnCents: 0 },
      { code: "TST4W4WWW0", completedAt: `${d(8)} 12:00:00`, details: "", paidInCents: 0, withdrawnCents: 500_000 },
    ]);
    assert.deepEqual({ m: res.matched, a: res.amount_mismatch, n: res.not_in_pos, w: res.withdrawal }, { m: 1, a: 1, n: 1, w: 1 });
    const again = await importStatement(tx, "statement.csv", [{ code: "TST4W4AAA1", completedAt: `${d(5)} 10:00:00`, details: "", paidInCents: 950_000, withdrawnCents: 0 }]);
    assert.equal(again.skipped, 1);
    const missing = await missingFromStatement(tx, d(1), d(31));
    assert.deepEqual(missing.map((m: any) => m.code), ["TST4W4CCC3"]);
  })));

after(async () => { await db.$client.end(); });
