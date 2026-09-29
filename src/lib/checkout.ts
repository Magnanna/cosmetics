import { randomBytes } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { customers, loyaltyLedger, orgs, products, registers, saleReturns, salePayments, saleLines, sales, shifts, variants, type Tx } from "@/db";
import { SYS } from "./coa";
import { ctx } from "./context";
import { formatReceiptNo, nextCounter } from "./counters";
import { creditOwedCents, earnsPoints } from "./customers";
import { removeStock } from "./inventory";
import { acct, postEntry, type PostLine } from "./ledger";
import { canRedeem, centipointsFor, earnedCentipoints, pointsValueCents, type LoyaltySettings } from "./loyalty";
import { allocate } from "./money";
import { applyOffers } from "./offers";
import { itemFacts, loadOffers } from "./offers-db";

export class CheckoutError extends Error {}

export type TenderMethod = "cash" | "mpesa" | "credit" | "points" | "exchange";

export interface CheckoutInput {
  idempotencyKey: string;
  registerId: number;
  customerId: number;
  lines: { variantId: number; qty: number; manualDiscountCents: number }[];
  cartDiscountCents: number;
  payments: { method: TenderMethod; amountCents: number; tenderedCents?: number; mpesaCode?: string; returnId?: number }[];
  /** Owner who approved a discount above the cashier limit (PIN checked before calling). */
  discountApprovedBy?: number | null;
  businessDate: string;
  /** For tests: the moment offers are evaluated. */
  now?: Date;
}

export interface CheckoutResult {
  saleId: number;
  receiptNo: string;
  receiptToken: string;
  totalCents: number;
  changeCents: number;
  pointsEarned: number;
  pointsBalance: number;
  replayed: boolean;
}

export const MPESA_CODE = /^[A-Z0-9]{10}$/;

export async function loyaltySettings(tx: Tx, orgId: number): Promise<LoyaltySettings> {
  const [o] = await tx
    .select({ earn: orgs.loyaltyEarnCentsPerPoint, value: orgs.loyaltyPointValueCents, min: orgs.loyaltyMinRedeemCents, limit: orgs.cashierDiscountLimitCents })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1);
  return { earnCentsPerPoint: o.earn, pointValueCents: o.value, minRedeemCents: o.min };
}

/**
 * Completes a sale in one transaction. Prices come from the customer's price
 * level and live offers (never from the till), stock leaves FIFO, loyalty
 * points are earned or spent, and one balanced journal entry records it all.
 * Replaying the same idempotency key returns the original sale.
 */
export async function checkout(tx: Tx, input: CheckoutInput): Promise<CheckoutResult> {
  const { orgId, memberId, role } = ctx();
  if (!memberId) throw new CheckoutError("Only a signed-in staff member can sell.");

  const [existing] = await tx
    .select({ id: sales.id, receiptNo: sales.receiptNo, receiptToken: sales.receiptToken, totalCents: sales.totalCents, pointsEarned: sales.pointsEarned, customerId: sales.customerId })
    .from(sales)
    .where(and(eq(sales.orgId, orgId), eq(sales.idempotencyKey, input.idempotencyKey)))
    .limit(1);
  if (existing) {
    const change = await tx.select({ c: salePayments.changeCents }).from(salePayments).where(eq(salePayments.saleId, existing.id));
    const [c] = await tx.select({ b: customers.pointsBalance }).from(customers).where(eq(customers.id, existing.customerId));
    return {
      saleId: existing.id, receiptNo: existing.receiptNo, receiptToken: existing.receiptToken, totalCents: existing.totalCents,
      changeCents: change.reduce((s, r) => s + (r.c ?? 0), 0), pointsEarned: existing.pointsEarned, pointsBalance: c.b, replayed: true,
    };
  }

  if (input.lines.length === 0) throw new CheckoutError("The cart is empty.");
  for (const l of input.lines) {
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new CheckoutError("Quantities must be whole numbers above zero.");
    if (!Number.isInteger(l.manualDiscountCents) || l.manualDiscountCents < 0) throw new CheckoutError("Discounts can't be negative.");
  }
  if (!Number.isInteger(input.cartDiscountCents) || input.cartDiscountCents < 0) throw new CheckoutError("Discounts can't be negative.");

  const [register] = await tx.select().from(registers).where(and(eq(registers.orgId, orgId), eq(registers.id, input.registerId))).limit(1);
  if (!register) throw new CheckoutError("Unknown till.");
  const [shift] = await tx.select({ id: shifts.id }).from(shifts).where(and(eq(shifts.orgId, orgId), eq(shifts.registerId, register.id), eq(shifts.status, "open"))).limit(1);
  if (!shift) throw new CheckoutError("Open the till (start a shift) before selling.");

  // Lock the customer row: points balance and credit are read and written below.
  const [customer] = await tx.select().from(customers).where(and(eq(customers.orgId, orgId), eq(customers.id, input.customerId))).for("update");
  if (!customer) throw new CheckoutError("Attach a customer phone number before checkout.");
  const level = customer.type === "wholesale" ? "wholesale" : "retail";
  const loyalty = await loyaltySettings(tx, orgId);

  // Prices, server-side.
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
    if (unit <= 0) throw new CheckoutError(`${name} has no price yet.`);
    return { ...l, unit, gross: unit * l.qty, name };
  });

  // Live offers price each line; manual discounts come off what's left.
  const facts = await itemFacts(tx, orgId, ids);
  const offerResult = applyOffers(
    priced.map((l) => ({ ...facts.get(l.variantId)!, unitCents: l.unit, qty: l.qty })),
    await loadOffers(tx, orgId, input.now),
    level,
    input.now ?? new Date()
  );
  const afterPromo = priced.map((l, i) => l.gross - offerResult.lines[i].promoDiscountCents);
  priced.forEach((l, i) => {
    if (l.manualDiscountCents > afterPromo[i]) throw new CheckoutError(`The discount on ${l.name} is more than its price.`);
  });
  const afterLine = afterPromo.map((a, i) => a - priced[i].manualDiscountCents);
  if (input.cartDiscountCents > afterLine.reduce((a, b) => a + b, 0)) throw new CheckoutError("The discount is more than the sale.");
  const cartShare = allocate(input.cartDiscountCents, afterLine);
  const manualByLine = priced.map((l, i) => l.manualDiscountCents + cartShare[i]);
  const grossCents = priced.reduce((s, l) => s + l.gross, 0);
  const promoDiscountCents = offerResult.lines.reduce((s, l) => s + l.promoDiscountCents, 0);
  const manualDiscountCents = manualByLine.reduce((a, b) => a + b, 0);
  const totalCents = grossCents - promoDiscountCents - manualDiscountCents;

  const [org] = await tx.select({ limit: orgs.cashierDiscountLimitCents }).from(orgs).where(eq(orgs.id, orgId)).limit(1);
  if (manualDiscountCents > org.limit && role !== "owner" && !input.discountApprovedBy) {
    throw new CheckoutError(`Discounts above KES ${(org.limit / 100).toLocaleString("en-KE")} need the owner's PIN.`);
  }

  // Tenders.
  if (input.payments.length === 0) throw new CheckoutError("Take a payment.");
  let changeCents = 0;
  let cashSeen = false;
  let pointsSpent = 0;
  const exchangeUse: { returnId: number; amount: number }[] = [];
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
      const [used] = await tx.execute<{ n: number }>(
        sql`select (select count(*) from sale_payments where org_id = ${orgId} and mpesa_code = ${code}) + (select count(*) from customer_payments where org_id = ${orgId} and mpesa_code = ${code}) as n`
      );
      if (Number(used.n) > 0) throw new CheckoutError(`M-Pesa code ${code} was already used.`);
    } else if (p.method === "credit") {
      if (!customer.creditEnabled) throw new CheckoutError("This customer doesn't have a credit account.");
      const available = customer.creditLimitCents - (await creditOwedCents(tx, customer.id));
      if (p.amountCents > available && role !== "owner") throw new CheckoutError(`Only KES ${(Math.max(0, available) / 100).toLocaleString("en-KE")} of credit is available.`);
    } else if (p.method === "points") {
      if (!earnsPoints(customer)) throw new CheckoutError("This customer isn't on the loyalty programme.");
      if (!canRedeem(customer.pointsBalance, loyalty)) throw new CheckoutError(`Points can be used once they're worth KES ${(loyalty.minRedeemCents / 100).toLocaleString("en-KE")}.`);
      const need = centipointsFor(p.amountCents, loyalty);
      if (pointsSpent + need > customer.pointsBalance) throw new CheckoutError(`Points cover up to KES ${(pointsValueCents(customer.pointsBalance - pointsSpent, loyalty) / 100).toFixed(2)}.`);
      pointsSpent += need;
    } else if (p.method === "exchange") {
      if (!p.returnId) throw new CheckoutError("Pick the return this exchange credit comes from.");
      const [ret] = await tx.select().from(saleReturns).where(and(eq(saleReturns.orgId, orgId), eq(saleReturns.id, p.returnId))).for("update");
      if (!ret || ret.kind !== "exchange") throw new CheckoutError("That exchange credit wasn't found.");
      if (ret.customerId !== customer.id) throw new CheckoutError("Exchange credit belongs to the customer who returned the items.");
      const already = exchangeUse.filter((e) => e.returnId === ret.id).reduce((s, e) => s + e.amount, 0);
      if (p.amountCents + already > ret.creditLeftCents) throw new CheckoutError(`Only KES ${(ret.creditLeftCents / 100).toFixed(2)} of exchange credit is left.`);
      exchangeUse.push({ returnId: ret.id, amount: p.amountCents });
    } else {
      throw new CheckoutError("Unsupported payment method.");
    }
  }
  const paid = input.payments.reduce((s, p) => s + p.amountCents, 0);
  if (paid !== totalCents) throw new CheckoutError(`Payments (${(paid / 100).toFixed(2)}) don't match the total (${(totalCents / 100).toFixed(2)}).`);

  // Points earned on what the customer actually paid (not on points, not on account until settled).
  let pointsEarned = 0;
  if (earnsPoints(customer)) {
    const nonEarning = input.payments.filter((p) => p.method === "points" || p.method === "credit").reduce((s, p) => s + p.amountCents, 0);
    const earningShare = allocate(totalCents - nonEarning, afterLine.map((a, i) => a - cartShare[i]));
    pointsEarned = earnedCentipoints(earningShare.map((c, i) => ({ paidCents: c, multiplier: offerResult.lines[i].pointsMultiplier })), loyalty) + offerResult.bonusCentipoints;
  }
  const earnedValue = pointsValueCents(pointsEarned, loyalty);
  const spentValue = input.payments.filter((p) => p.method === "points").reduce((s, p) => s + p.amountCents, 0);

  const receiptNo = formatReceiptNo(await nextCounter(tx, "receipt"));
  const receiptToken = randomBytes(18).toString("base64url");
  const [sale] = await tx
    .insert(sales)
    .values({
      orgId, receiptNo, receiptToken, registerId: register.id, shiftId: shift.id, memberId, customerId: customer.id, priceLevel: level,
      businessDate: input.businessDate, grossCents, manualDiscountCents, promoDiscountCents, totalCents, costCents: 0, pointsEarned,
      discountApprovedBy: input.discountApprovedBy ?? null, idempotencyKey: input.idempotencyKey,
    })
    .returning({ id: sales.id });

  let costCents = 0;
  for (const [i, l] of priced.entries()) {
    const { costCents: c } = await removeStock(tx, { variantId: l.variantId, qty: l.qty, date: input.businessDate, sourceType: "sale", sourceId: sale.id, locationId: register.locationId });
    costCents += c;
    await tx.insert(saleLines).values({
      orgId, saleId: sale.id, variantId: l.variantId, description: l.name, qty: l.qty, unitPriceCents: l.unit,
      manualDiscountCents: manualByLine[i], promoDiscountCents: offerResult.lines[i].promoDiscountCents, offerId: offerResult.lines[i].offerId,
      lineTotalCents: afterLine[i] - cartShare[i], costCents: c,
    });
  }

  await tx.insert(salePayments).values(
    input.payments.map((p) => ({
      orgId, saleId: sale.id, method: p.method, amountCents: p.amountCents,
      tenderedCents: p.method === "cash" ? p.tenderedCents ?? p.amountCents : null,
      changeCents: p.method === "cash" ? changeCents : null,
      mpesaCode: p.method === "mpesa" ? p.mpesaCode! : null,
      returnId: p.method === "exchange" ? p.returnId! : null,
      pointsSpent: p.method === "points" ? centipointsFor(p.amountCents, loyalty) : null,
    }))
  );
  for (const e of exchangeUse) {
    await tx.update(saleReturns).set({ creditLeftCents: sql`${saleReturns.creditLeftCents} - ${e.amount}` }).where(eq(saleReturns.id, e.returnId));
  }

  // Loyalty balance and history.
  const pointsBalance = customer.pointsBalance - pointsSpent + pointsEarned;
  if (pointsSpent || pointsEarned) {
    await tx.update(customers).set({ pointsBalance }).where(eq(customers.id, customer.id));
    const entries = [];
    if (pointsSpent) entries.push({ orgId, customerId: customer.id, kind: "redeem", points: -pointsSpent, valueCents: -spentValue, saleId: sale.id, memberId });
    if (pointsEarned - offerResult.bonusCentipoints > 0) {
      const base = pointsEarned - offerResult.bonusCentipoints;
      entries.push({ orgId, customerId: customer.id, kind: "earn", points: base, valueCents: pointsValueCents(base, loyalty), saleId: sale.id, memberId });
    }
    for (const b of offerResult.bonusOffers) {
      entries.push({ orgId, customerId: customer.id, kind: "bonus", points: b.centipoints, valueCents: pointsValueCents(b.centipoints, loyalty), saleId: sale.id, note: b.title, memberId });
    }
    // Keep the ledger's value column summing to exactly what hit Loyalty Liability.
    const recorded = entries.filter((e) => e.valueCents > 0).reduce((s, e) => s + e.valueCents, 0);
    const lastEarn = entries.filter((e) => e.valueCents > 0).at(-1);
    if (lastEarn) lastEarn.valueCents += earnedValue - recorded;
    if (entries.length) await tx.insert(loyaltyLedger).values(entries);
  }

  const TENDER_ACCOUNT: Record<TenderMethod, string> = { cash: SYS.CASH_DRAWER, mpesa: SYS.MPESA_TILL, credit: SYS.AR, points: SYS.LOYALTY_LIABILITY, exchange: SYS.EXCHANGE_CREDIT };
  const journal: PostLine[] = [
    { accountId: await acct(tx, level === "wholesale" ? SYS.SALES_WHOLESALE : SYS.SALES_RETAIL), creditCents: grossCents, customerId: customer.id },
    { accountId: await acct(tx, SYS.PROMO_DISCOUNTS), debitCents: promoDiscountCents },
    { accountId: await acct(tx, SYS.MANUAL_DISCOUNTS), debitCents: manualDiscountCents },
  ];
  for (const p of input.payments) {
    journal.push({ accountId: await acct(tx, TENDER_ACCOUNT[p.method]), debitCents: p.amountCents, customerId: p.method === "credit" ? customer.id : null, memo: p.mpesaCode ?? undefined });
  }
  journal.push(
    { accountId: await acct(tx, SYS.COGS), debitCents: costCents },
    { accountId: await acct(tx, SYS.INVENTORY), creditCents: costCents },
    { accountId: await acct(tx, SYS.LOYALTY_EXPENSE), debitCents: earnedValue, memo: "Points earned" },
    { accountId: await acct(tx, SYS.LOYALTY_LIABILITY), creditCents: earnedValue, customerId: customer.id }
  );
  const entryId = await postEntry(tx, { date: input.businessDate, memo: `Sale ${receiptNo}`, sourceType: "sale", sourceId: sale.id, lines: journal });
  await tx.update(sales).set({ journalEntryId: entryId, costCents }).where(eq(sales.id, sale.id));

  return { saleId: sale.id, receiptNo, receiptToken, totalCents, changeCents, pointsEarned, pointsBalance, replayed: false };
}
