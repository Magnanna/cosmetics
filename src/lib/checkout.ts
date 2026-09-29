import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { customers, orgs, products, registers, salePayments, saleLines, sales, shifts, variants, type Tx } from "@/db";
import { SYS } from "./coa";
import { ctx } from "./context";
import { formatReceiptNo, nextCounter } from "./counters";
import { creditOwedCents } from "./customers";
import { removeStock } from "./inventory";
import { acct, postEntry, type PostLine } from "./ledger";
import { allocate } from "./money";

export class CheckoutError extends Error {}

export type TenderMethod = "cash" | "mpesa" | "credit";

export interface CheckoutInput {
  idempotencyKey: string;
  registerId: number;
  customerId: number;
  lines: { variantId: number; qty: number; manualDiscountCents: number }[];
  cartDiscountCents: number;
  payments: { method: TenderMethod; amountCents: number; tenderedCents?: number; mpesaCode?: string }[];
  /** Owner who approved a discount above the cashier limit (verified by PIN before calling). */
  discountApprovedBy?: number | null;
  businessDate: string;
}

export interface CheckoutResult {
  saleId: number;
  receiptNo: string;
  receiptToken: string;
  totalCents: number;
  changeCents: number;
  replayed: boolean;
}

export const MPESA_CODE = /^[A-Z0-9]{10}$/;

/**
 * Completes a sale in one transaction: prices are resolved server-side from
 * the customer's price level (never trusted from the till), stock leaves FIFO,
 * and one balanced journal entry records revenue, discounts, tenders and cost.
 * Replaying the same idempotency key returns the original sale.
 */
export async function checkout(tx: Tx, input: CheckoutInput): Promise<CheckoutResult> {
  const { orgId, memberId, role } = ctx();
  if (!memberId) throw new CheckoutError("Only a signed-in staff member can sell.");

  const [existing] = await tx
    .select({ id: sales.id, receiptNo: sales.receiptNo, receiptToken: sales.receiptToken, totalCents: sales.totalCents })
    .from(sales)
    .where(and(eq(sales.orgId, orgId), eq(sales.idempotencyKey, input.idempotencyKey)))
    .limit(1);
  if (existing) {
    const change = await tx.select({ c: salePayments.changeCents }).from(salePayments).where(eq(salePayments.saleId, existing.id));
    return { saleId: existing.id, receiptNo: existing.receiptNo, receiptToken: existing.receiptToken, totalCents: existing.totalCents, changeCents: change.reduce((s, r) => s + (r.c ?? 0), 0), replayed: true };
  }

  if (input.lines.length === 0) throw new CheckoutError("The cart is empty.");
  for (const l of input.lines) {
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new CheckoutError("Quantities must be whole numbers above zero.");
    if (!Number.isInteger(l.manualDiscountCents) || l.manualDiscountCents < 0) throw new CheckoutError("Discounts can't be negative.");
  }
  if (!Number.isInteger(input.cartDiscountCents) || input.cartDiscountCents < 0) throw new CheckoutError("Discounts can't be negative.");

  const [register] = await tx.select().from(registers).where(and(eq(registers.orgId, orgId), eq(registers.id, input.registerId))).limit(1);
  if (!register) throw new CheckoutError("Unknown till.");
  const [shift] = await tx
    .select({ id: shifts.id })
    .from(shifts)
    .where(and(eq(shifts.orgId, orgId), eq(shifts.registerId, register.id), eq(shifts.status, "open")))
    .limit(1);
  if (!shift) throw new CheckoutError("Open the till (start a shift) before selling.");

  const [customer] = await tx.select().from(customers).where(and(eq(customers.orgId, orgId), eq(customers.id, input.customerId))).limit(1);
  if (!customer) throw new CheckoutError("Attach a customer phone number before checkout.");
  const level = customer.type === "wholesale" ? "wholesale" : "retail";

  // Resolve prices server-side.
  const ids = [...new Set(input.lines.map((l) => l.variantId))];
  const rows = await tx
    .select({ v: variants, productName: products.name })
    .from(variants)
    .innerJoin(products, eq(products.id, variants.productId))
    .where(and(eq(variants.orgId, orgId), inArray(variants.id, ids)));
  const byId = new Map(rows.map((r) => [r.v.id, r]));

  const priced = input.lines.map((l) => {
    const r = byId.get(l.variantId);
    if (!r || r.v.archived) throw new CheckoutError("An item in the cart is no longer sold.");
    const unit = level === "wholesale" && r.v.wholesalePriceCents > 0 ? r.v.wholesalePriceCents : r.v.retailPriceCents;
    const name = [r.productName, r.v.option1Value, r.v.option2Value].filter(Boolean).join(" · ");
    if (unit <= 0) throw new CheckoutError(`${name} has no approved price yet.`);
    const gross = unit * l.qty;
    if (l.manualDiscountCents > gross) throw new CheckoutError(`The discount on ${name} is more than its price.`);
    return { ...l, unit, gross, name };
  });

  // Spread the cart discount across lines so each line's net stays correct for returns.
  const grossCents = priced.reduce((s, l) => s + l.gross, 0);
  const afterLine = priced.map((l) => l.gross - l.manualDiscountCents);
  if (input.cartDiscountCents > afterLine.reduce((a, b) => a + b, 0)) throw new CheckoutError("The discount is more than the sale.");
  const cartShare = allocate(input.cartDiscountCents, afterLine);
  const lineDiscounts = priced.map((l, i) => l.manualDiscountCents + cartShare[i]);
  const manualDiscountCents = lineDiscounts.reduce((a, b) => a + b, 0);
  const totalCents = grossCents - manualDiscountCents;

  const [org] = await tx.select({ limit: orgs.cashierDiscountLimitCents }).from(orgs).where(eq(orgs.id, orgId)).limit(1);
  if (manualDiscountCents > org.limit && role !== "owner" && !input.discountApprovedBy) {
    throw new CheckoutError(`Discounts above KES ${(org.limit / 100).toLocaleString("en-KE")} need the owner's approval.`);
  }

  // Tenders.
  if (input.payments.length === 0) throw new CheckoutError("Take a payment.");
  let changeCents = 0;
  let cashSeen = false;
  for (const p of input.payments) {
    if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) throw new CheckoutError("Payment amounts must be above zero.");
    if (p.method === "cash") {
      if (cashSeen) throw new CheckoutError("Combine cash into one payment.");
      cashSeen = true;
      const tendered = p.tenderedCents ?? p.amountCents;
      if (tendered < p.amountCents) throw new CheckoutError("Cash handed over is less than the cash amount.");
      changeCents = tendered - p.amountCents;
    } else if (p.method === "mpesa") {
      const code = (p.mpesaCode ?? "").trim().toUpperCase();
      if (!MPESA_CODE.test(code)) throw new CheckoutError("An M-Pesa code is 10 letters and numbers, e.g. SJK4H7QX2M.");
      p.mpesaCode = code;
      const [used] = await tx.select({ id: salePayments.id }).from(salePayments).where(and(eq(salePayments.orgId, orgId), eq(salePayments.mpesaCode, code))).limit(1);
      if (used) throw new CheckoutError(`M-Pesa code ${code} was already used on another sale.`);
    } else if (p.method === "credit") {
      if (!customer.creditEnabled) throw new CheckoutError("This customer doesn't have a credit account.");
      const owed = await creditOwedCents(tx, customer.id);
      const available = customer.creditLimitCents - owed;
      if (p.amountCents > available && role !== "owner") {
        throw new CheckoutError(`Only KES ${(Math.max(0, available) / 100).toLocaleString("en-KE")} of credit is available.`);
      }
    } else {
      throw new CheckoutError("Unsupported payment method.");
    }
  }
  const paid = input.payments.reduce((s, p) => s + p.amountCents, 0);
  if (paid !== totalCents) throw new CheckoutError(`Payments (${paid / 100}) don't match the total (${totalCents / 100}).`);

  const receiptNo = formatReceiptNo(await nextCounter(tx, "receipt"));
  const receiptToken = randomBytes(18).toString("base64url");

  const [sale] = await tx
    .insert(sales)
    .values({
      orgId,
      receiptNo,
      receiptToken,
      registerId: register.id,
      shiftId: shift.id,
      memberId,
      customerId: customer.id,
      priceLevel: level,
      businessDate: input.businessDate,
      grossCents,
      manualDiscountCents,
      totalCents,
      costCents: 0,
      discountApprovedBy: input.discountApprovedBy ?? null,
      idempotencyKey: input.idempotencyKey,
    })
    .returning({ id: sales.id });

  let costCents = 0;
  for (const [i, l] of priced.entries()) {
    const { costCents: c } = await removeStock(tx, { variantId: l.variantId, qty: l.qty, date: input.businessDate, sourceType: "sale", sourceId: sale.id, locationId: register.locationId });
    costCents += c;
    await tx.insert(saleLines).values({
      orgId,
      saleId: sale.id,
      variantId: l.variantId,
      description: l.name,
      qty: l.qty,
      unitPriceCents: l.unit,
      manualDiscountCents: lineDiscounts[i],
      lineTotalCents: l.gross - lineDiscounts[i],
      costCents: c,
    });
  }

  await tx.insert(salePayments).values(
    input.payments.map((p) => ({
      orgId,
      saleId: sale.id,
      method: p.method,
      amountCents: p.amountCents,
      tenderedCents: p.method === "cash" ? p.tenderedCents ?? p.amountCents : null,
      changeCents: p.method === "cash" ? changeCents : null,
      mpesaCode: p.method === "mpesa" ? p.mpesaCode! : null,
    }))
  );

  const TENDER_ACCOUNT: Record<TenderMethod, string> = { cash: SYS.CASH_DRAWER, mpesa: SYS.MPESA_TILL, credit: SYS.AR };
  const journal: PostLine[] = [
    { accountId: await acct(tx, level === "wholesale" ? SYS.SALES_WHOLESALE : SYS.SALES_RETAIL), creditCents: grossCents, customerId: customer.id },
    { accountId: await acct(tx, SYS.MANUAL_DISCOUNTS), debitCents: manualDiscountCents },
  ];
  for (const p of input.payments) {
    journal.push({
      accountId: await acct(tx, TENDER_ACCOUNT[p.method]),
      debitCents: p.amountCents,
      customerId: p.method === "credit" ? customer.id : null,
      memo: p.mpesaCode ?? undefined,
    });
  }
  journal.push({ accountId: await acct(tx, SYS.COGS), debitCents: costCents }, { accountId: await acct(tx, SYS.INVENTORY), creditCents: costCents });

  const entryId = await postEntry(tx, { date: input.businessDate, memo: `Sale ${receiptNo}`, sourceType: "sale", sourceId: sale.id, lines: journal });
  await tx.update(sales).set({ journalEntryId: entryId, costCents }).where(eq(sales.id, sale.id));

  return { saleId: sale.id, receiptNo, receiptToken, totalCents, changeCents, replayed: false };
}
