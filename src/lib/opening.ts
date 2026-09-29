import { and, eq } from "drizzle-orm";
import { bills, customers, suppliers, type Tx } from "@/db";
import { SYS } from "./coa";
import { ctx } from "./context";
import { acct, postEntry } from "./ledger";
import { MONEY_ACCOUNTS, type MoneyAccount } from "./money-ops";

/**
 * Go-live balances: what the shop had and owed the day it started using the
 * system. Each posts against Opening Balance Equity. (Opening stock is entered
 * per product, with its cost, when products are created or received.)
 */

export class OpeningError extends Error {}

export async function openingMoney(tx: Tx, p: { date: string; account: MoneyAccount; amountCents: number }) {
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) throw new OpeningError("Enter an amount above zero.");
  return postEntry(tx, {
    date: p.date,
    memo: `Opening balance: ${MONEY_ACCOUNTS[p.account].label}`,
    sourceType: "opening_balance",
    lines: [
      { accountId: await acct(tx, MONEY_ACCOUNTS[p.account].code), debitCents: p.amountCents },
      { accountId: await acct(tx, SYS.OPENING_BALANCE), creditCents: p.amountCents },
    ],
  });
}

/** An unpaid supplier invoice from before go-live. Recorded as a bill so payments can clear it. */
export async function openingSupplierDebt(tx: Tx, p: { date: string; supplierId: number; amountCents: number; reference: string }) {
  const { orgId, memberId } = ctx();
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) throw new OpeningError("Enter an amount above zero.");
  const [s] = await tx.select({ id: suppliers.id, terms: suppliers.termsDays }).from(suppliers).where(and(eq(suppliers.orgId, orgId), eq(suppliers.id, p.supplierId))).limit(1);
  if (!s) throw new OpeningError("Pick a supplier.");
  const [bill] = await tx
    .insert(bills)
    .values({
      orgId, supplierId: s.id, supplierInvoiceNo: p.reference.trim() || `Opening balance ${p.date}`, invoiceDate: p.date, dueDate: p.date,
      ratesIncludeVat: true, netCents: p.amountCents, vatCents: 0, totalCents: p.amountCents, notes: "Owed before go-live", memberId,
    })
    .returning({ id: bills.id });
  const entryId = await postEntry(tx, {
    date: p.date,
    memo: `Opening balance owed to supplier (${p.reference || "before go-live"})`,
    sourceType: "opening_balance",
    sourceId: bill.id,
    lines: [
      { accountId: await acct(tx, SYS.OPENING_BALANCE), debitCents: p.amountCents },
      { accountId: await acct(tx, SYS.AP), creditCents: p.amountCents, supplierId: s.id },
    ],
  });
  await tx.update(bills).set({ journalEntryId: entryId }).where(eq(bills.id, bill.id));
  return bill.id;
}

/** What a credit customer owed before go-live. Shows on their statement and ages from this date. */
export async function openingCustomerDebt(tx: Tx, p: { date: string; customerId: number; amountCents: number }) {
  const { orgId } = ctx();
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) throw new OpeningError("Enter an amount above zero.");
  const [c] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.orgId, orgId), eq(customers.id, p.customerId))).limit(1);
  if (!c) throw new OpeningError("Pick a customer.");
  return postEntry(tx, {
    date: p.date,
    memo: "Opening balance owed by customer",
    sourceType: "opening_balance",
    lines: [
      { accountId: await acct(tx, SYS.AR), debitCents: p.amountCents, customerId: c.id },
      { accountId: await acct(tx, SYS.OPENING_BALANCE), creditCents: p.amountCents },
    ],
  });
}
