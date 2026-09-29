import { and, eq, sql } from "drizzle-orm";
import { customers, loyaltyLedger, orgs, registers, saleLines, saleReturnLines, saleReturns, sales, shifts, type Tx } from "@/db";
import { loyaltySettings } from "./checkout";
import { SYS } from "./coa";
import { ctx } from "./context";
import { nextCounter } from "./counters";
import { addStock } from "./inventory";
import { acct, postEntry, signedPair, type PostLine } from "./ledger";
import { centipointsFor, pointsValueCents } from "./loyalty";

/**
 * Returns and exchanges (policy: within 24 hours, unopened items only).
 * - Exchange (default): the value becomes exchange credit spent on a new sale.
 * - Refund: money back — needs the owner (role or PIN).
 * Returned stock goes back at the exact cost it left with; points earned on
 * the returned share of the sale are taken back.
 */

export class ReturnError extends Error {}

export type RefundMethod = "cash" | "mpesa" | "credit" | "points";

export interface ReturnInput {
  idempotencyKey: string;
  saleId: number;
  registerId: number;
  kind: "exchange" | "refund";
  refundMethod?: RefundMethod;
  lines: { saleLineId: number; qty: number }[];
  /** The cashier ticked "unopened and unused" for every line. */
  unopenedConfirmed: boolean;
  /** Owner who approved by PIN (refunds, or returns after the window). */
  approvedBy?: number | null;
  businessDate: string;
  now?: Date;
}

export function formatReturnNo(n: number) {
  return `RT-${String(n).padStart(6, "0")}`;
}

export async function processReturn(tx: Tx, input: ReturnInput): Promise<{ returnId: number; returnNo: string; totalCents: number; creditCents: number; replayed: boolean }> {
  const { orgId, memberId, role } = ctx();
  if (!memberId) throw new ReturnError("Sign in first.");

  const [prior] = await tx.select().from(saleReturns).where(and(eq(saleReturns.orgId, orgId), eq(saleReturns.idempotencyKey, input.idempotencyKey))).limit(1);
  if (prior) return { returnId: prior.id, returnNo: prior.returnNo, totalCents: prior.totalCents, creditCents: prior.creditLeftCents, replayed: true };

  if (!input.unopenedConfirmed) throw new ReturnError("Only unopened, unused items can be returned. Confirm each item is sealed.");
  if (input.lines.length === 0) throw new ReturnError("Pick the items being returned.");
  const ownerOk = role === "owner" || !!input.approvedBy;
  if (input.kind === "refund" && !ownerOk) throw new ReturnError("Money refunds need the owner's PIN. An exchange doesn't.");
  if (input.kind === "refund" && !input.refundMethod) throw new ReturnError("Choose how the money goes back.");

  const [sale] = await tx.select().from(sales).where(and(eq(sales.orgId, orgId), eq(sales.id, input.saleId))).for("update");
  if (!sale) throw new ReturnError("Receipt not found.");
  const [org] = await tx.select({ hours: orgs.returnWindowHours }).from(orgs).where(eq(orgs.id, orgId));
  const ageHours = ((input.now ?? new Date()).getTime() - sale.createdAt.getTime()) / 3_600_000;
  if (ageHours > org.hours && !ownerOk) throw new ReturnError(`This sale is older than ${org.hours} hours. The owner can approve it with their PIN.`);

  const [register] = await tx.select().from(registers).where(and(eq(registers.orgId, orgId), eq(registers.id, input.registerId))).limit(1);
  if (!register) throw new ReturnError("Unknown till.");
  const [shift] = await tx.select({ id: shifts.id }).from(shifts).where(and(eq(shifts.orgId, orgId), eq(shifts.registerId, register.id), eq(shifts.status, "open"))).limit(1);
  if (!shift) throw new ReturnError("Open the till before processing returns.");

  const [customer] = await tx.select().from(customers).where(eq(customers.id, sale.customerId)).for("update");
  if (input.refundMethod === "credit" && input.kind === "refund") {
    const [creditPaid] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from sale_payments where sale_id = ${sale.id} and method = 'credit'`);
    if (!Number(creditPaid.n)) throw new ReturnError("This sale wasn't on account, so it can't be refunded to the account.");
  }

  // Price each returned line from what was actually paid, exact on the last unit.
  const picked: { line: typeof saleLines.$inferSelect; qty: number; amount: number; cost: number }[] = [];
  for (const r of input.lines) {
    if (!Number.isInteger(r.qty) || r.qty <= 0) throw new ReturnError("Return quantities must be whole numbers above zero.");
    const [line] = await tx.select().from(saleLines).where(and(eq(saleLines.id, r.saleLineId), eq(saleLines.saleId, sale.id))).for("update");
    if (!line) throw new ReturnError("That item isn't on this receipt.");
    const left = line.qty - line.returnedQty;
    if (r.qty > left) throw new ReturnError(`Only ${left} of ${line.description} can still be returned.`);
    const [done] = await tx.execute<{ amount: string; cost: string }>(
      sql`select coalesce(sum(amount_cents),0) as amount, coalesce(sum(cost_cents),0) as cost from sale_return_lines where sale_line_id = ${line.id}`
    );
    const finishing = r.qty === left;
    const amount = finishing ? line.lineTotalCents - Number(done.amount) : Math.round((line.lineTotalCents * r.qty) / line.qty);
    const cost = finishing ? line.costCents - Number(done.cost) : Math.round((line.costCents * r.qty) / line.qty);
    picked.push({ line, qty: r.qty, amount, cost });
  }
  const totalCents = picked.reduce((s, p) => s + p.amount, 0);
  const costCents = picked.reduce((s, p) => s + p.cost, 0);

  const returnNo = formatReturnNo(await nextCounter(tx, "return"));
  const [ret] = await tx
    .insert(saleReturns)
    .values({
      orgId, returnNo, saleId: sale.id, shiftId: shift.id, customerId: sale.customerId, kind: input.kind,
      refundMethod: input.kind === "refund" ? input.refundMethod! : null, totalCents, costCents,
      creditLeftCents: input.kind === "exchange" ? totalCents : 0, approvedBy: input.approvedBy ?? null, memberId, idempotencyKey: input.idempotencyKey,
    })
    .returning({ id: saleReturns.id });

  for (const p of picked) {
    await tx.insert(saleReturnLines).values({ orgId, returnId: ret.id, saleLineId: p.line.id, variantId: p.line.variantId, qty: p.qty, amountCents: p.amount, costCents: p.cost });
    await tx.update(saleLines).set({ returnedQty: p.line.returnedQty + p.qty }).where(eq(saleLines.id, p.line.id));
    await addStock(tx, { variantId: p.line.variantId, qty: p.qty, totalCostCents: p.cost, date: input.businessDate, sourceType: "return", sourceId: ret.id, locationId: register.locationId });
  }
  const [{ open }] = await tx.execute<{ open: number }>(sql`select coalesce(sum(qty - returned_qty),0)::int as open from sale_lines where sale_id = ${sale.id}`);
  await tx.update(sales).set({ status: Number(open) === 0 ? "returned" : "partially_returned" }).where(eq(sales.id, sale.id));

  // Loyalty: take back points earned on the returned share; a points refund adds points.
  const loyalty = await loyaltySettings(tx, orgId);
  const reversed = sale.totalCents > 0 ? Math.floor((sale.pointsEarned * totalCents) / sale.totalCents) : 0;
  const reversedValue = pointsValueCents(reversed, loyalty);
  const refundPoints = input.kind === "refund" && input.refundMethod === "points" ? centipointsFor(totalCents, loyalty) : 0;
  if (reversed || refundPoints) {
    await tx.update(customers).set({ pointsBalance: customer.pointsBalance - reversed + refundPoints }).where(eq(customers.id, customer.id));
    const rows = [];
    if (reversed) rows.push({ orgId, customerId: customer.id, kind: "reverse", points: -reversed, valueCents: -reversedValue, saleId: sale.id, returnId: ret.id, note: returnNo, memberId });
    if (refundPoints) rows.push({ orgId, customerId: customer.id, kind: "adjust", points: refundPoints, valueCents: totalCents, saleId: sale.id, returnId: ret.id, note: `Refund ${returnNo} as points`, memberId });
    await tx.insert(loyaltyLedger).values(rows);
  }

  const REFUND_ACCOUNT: Record<RefundMethod, string> = { cash: SYS.CASH_DRAWER, mpesa: SYS.MPESA_TILL, credit: SYS.AR, points: SYS.LOYALTY_LIABILITY };
  const creditAccount = input.kind === "exchange" ? SYS.EXCHANGE_CREDIT : REFUND_ACCOUNT[input.refundMethod!];
  const journal: PostLine[] = [
    { accountId: await acct(tx, SYS.SALES_RETURNS), debitCents: totalCents, customerId: customer.id },
    { accountId: await acct(tx, creditAccount), creditCents: totalCents, customerId: creditAccount === SYS.AR ? customer.id : null },
    ...signedPair(costCents, await acct(tx, SYS.INVENTORY), await acct(tx, SYS.COGS), "Returned to stock"),
    ...signedPair(reversedValue, await acct(tx, SYS.LOYALTY_LIABILITY), await acct(tx, SYS.LOYALTY_EXPENSE), "Points taken back"),
  ];
  const entryId = await postEntry(tx, { date: input.businessDate, memo: `${input.kind === "exchange" ? "Exchange" : "Refund"} ${returnNo} for ${sale.receiptNo}`, sourceType: "sale_return", sourceId: ret.id, lines: journal });
  await tx.update(saleReturns).set({ journalEntryId: entryId }).where(eq(saleReturns.id, ret.id));

  return { returnId: ret.id, returnNo, totalCents, creditCents: input.kind === "exchange" ? totalCents : 0, replayed: false };
}

/**
 * Exchange credit the customer didn't spend (new item was cheaper), paid out
 * in cash or M-Pesa. Needs the owner, like any refund.
 */
export async function refundExchangeCredit(tx: Tx, p: { returnId: number; method: "cash" | "mpesa"; approvedBy?: number | null; date: string }): Promise<number> {
  const { orgId, role } = ctx();
  if (role !== "owner" && !p.approvedBy) throw new ReturnError("Paying out exchange credit needs the owner's PIN.");
  const [ret] = await tx.select().from(saleReturns).where(and(eq(saleReturns.orgId, orgId), eq(saleReturns.id, p.returnId))).for("update");
  if (!ret || ret.kind !== "exchange") throw new ReturnError("Exchange not found.");
  if (ret.creditLeftCents <= 0) throw new ReturnError("There's no exchange credit left on this return.");
  const amount = ret.creditLeftCents;
  await tx.update(saleReturns).set({ creditLeftCents: 0 }).where(eq(saleReturns.id, ret.id));
  await postEntry(tx, {
    date: p.date,
    memo: `Paid out unused exchange credit ${ret.returnNo}`,
    sourceType: "exchange_payout",
    sourceId: ret.id,
    lines: [
      { accountId: await acct(tx, SYS.EXCHANGE_CREDIT), debitCents: amount, customerId: ret.customerId },
      { accountId: await acct(tx, p.method === "cash" ? SYS.CASH_DRAWER : SYS.MPESA_TILL), creditCents: amount },
    ],
  });
  return amount;
}
