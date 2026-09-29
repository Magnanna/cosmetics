"use server";

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, customers, orgs, registers, saleLines, saleReturns, sales } from "@/db";
import { audit, ForbiddenError, withSession } from "@/lib/auth";
import { CashError, closeShift, DENOMINATIONS, recordCashMovement, shiftSummary, type CashReason, type ShiftSummary } from "@/lib/cashup";
import { checkout, CheckoutError, type CheckoutResult } from "@/lib/checkout";
import { CreditError, receiveCustomerPayment } from "@/lib/credit";
import { createCustomer, creditOwedCents, CustomerError, earnsPoints, findCustomerByPhone, type Customer } from "@/lib/customers";
import { canRedeem, pointsValueCents } from "@/lib/loyalty";
import { maskPhone, normalizeKenyanPhone } from "@/lib/phone";
import { PinError, verifyOwnerPin } from "@/lib/pin";
import { processReturn, refundExchangeCredit, ReturnError } from "@/lib/returns";
import { openShift, openShiftFor, ShiftError } from "@/lib/shifts";
import { sendSaleReceiptSms } from "@/lib/sms";
import { nairobiDate } from "@/lib/time";

export interface TillCustomer {
  id: number;
  name: string | null;
  phoneMasked: string;
  type: "retail" | "wholesale";
  businessName: string | null;
  earnsPoints: boolean;
  pointsBalance: number;
  pointsValueCents: number;
  canRedeemPoints: boolean;
  creditEnabled: boolean;
  creditOwedCents: number;
  creditAvailableCents: number;
}

async function toTillCustomer(c: Customer): Promise<TillCustomer> {
  const [o] = await db.select().from(orgs).where(eq(orgs.id, c.orgId)).limit(1);
  const s = { earnCentsPerPoint: o.loyaltyEarnCentsPerPoint, pointValueCents: o.loyaltyPointValueCents, minRedeemCents: o.loyaltyMinRedeemCents };
  const owed = await creditOwedCents(db, c.id);
  const earns = earnsPoints(c);
  return {
    id: c.id,
    name: c.name,
    phoneMasked: maskPhone(c.phone),
    type: c.type as "retail" | "wholesale",
    businessName: c.businessName,
    earnsPoints: earns,
    pointsBalance: c.pointsBalance,
    pointsValueCents: earns ? pointsValueCents(Math.max(0, c.pointsBalance), s) : 0,
    canRedeemPoints: earns && canRedeem(c.pointsBalance, s),
    creditEnabled: c.creditEnabled,
    creditOwedCents: owed,
    creditAvailableCents: c.creditEnabled ? Math.max(0, c.creditLimitCents - owed) : 0,
  };
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const KNOWN = [CheckoutError, CustomerError, ShiftError, ForbiddenError, PinError, ReturnError, CashError, CreditError];
async function guard<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (KNOWN.some((K) => e instanceof K)) return { ok: false, error: (e as Error).message };
    console.error(e);
    return { ok: false, error: "Something went wrong — nothing was saved. Try again." };
  }
}

/** Postgres errors arrive either raw (postgres-js) or wrapped by Drizzle in `.cause`. */
function pgError(e: unknown): { code?: string; constraint?: string } {
  const c = ((e as { cause?: unknown }).cause ?? e) as { code?: string; constraint_name?: string };
  return { code: c.code, constraint: c.constraint_name };
}

async function currentShiftId(registerId: number): Promise<number> {
  const shift = await openShiftFor(db, registerId);
  if (!shift) throw new ShiftError("Open the till first.");
  return shift.id;
}

/* ---------------- Customers ---------------- */

export async function lookupCustomer(phone: string): Promise<Result<TillCustomer | null>> {
  return guard(() =>
    withSession("customers.view", async () => {
      const c = await findCustomerByPhone(db, phone);
      return c ? toTillCustomer(c) : null;
    })
  );
}

export async function refreshCustomer(customerId: number): Promise<Result<TillCustomer>> {
  return guard(() =>
    withSession("customers.view", async (s) => {
      const [c] = await db.select().from(customers).where(and(eq(customers.orgId, s.org.id), eq(customers.id, customerId))).limit(1);
      if (!c) throw new CustomerError("Customer not found.");
      return toTillCustomer(c);
    })
  );
}

export async function quickCreateCustomer(input: { phone: string; name: string; marketingConsent: boolean }): Promise<Result<TillCustomer>> {
  return guard(() =>
    withSession("customers.edit", async () => {
      const c = await db.transaction(async (tx) => {
        const row = await createCustomer(tx, { phone: input.phone, name: input.name, marketingConsent: input.marketingConsent });
        await audit(tx, { action: "customer.create", entity: "customer", entityId: row.id, after: { name: row.name, consent: row.marketingConsent } });
        return row;
      });
      return toTillCustomer(c);
    })
  );
}

/* ---------------- Shift ---------------- */

export async function startShift(registerId: number, openingFloatCents: number): Promise<Result<number>> {
  return guard(() =>
    withSession("till.sell", (s) =>
      db.transaction(async (tx) => {
        const [reg] = await tx.select({ id: registers.id }).from(registers).where(and(eq(registers.orgId, s.org.id), eq(registers.id, registerId))).limit(1);
        if (!reg) throw new ShiftError("Unknown till.");
        const id = await openShift(tx, { registerId, openingFloatCents, date: nairobiDate() });
        await audit(tx, { action: "shift.open", entity: "shift", entityId: id, after: { openingFloatCents } });
        return id;
      })
    )
  );
}

export async function xReport(registerId: number): Promise<Result<ShiftSummary>> {
  return guard(() => withSession("till.sell", async () => shiftSummary(db, await currentShiftId(registerId))));
}

export async function cashMovement(registerId: number, input: { reason: CashReason; amountCents: number; note: string; expenseAccountCode?: string }): Promise<Result<null>> {
  return guard(() =>
    withSession("till.sell", async () => {
      const shiftId = await currentShiftId(registerId);
      await db.transaction(async (tx) => {
        const id = await recordCashMovement(tx, { shiftId, ...input, date: nairobiDate() });
        await audit(tx, { action: "cash.movement", entity: "cash_movement", entityId: id, after: input });
      });
      return null;
    })
  );
}

/** Blind count: the expected amount is only revealed after the count is saved. */
export async function endShift(registerId: number, counts: Record<string, number>): Promise<Result<{ countedCents: number; expectedCents: number; varianceCents: number; summary: ShiftSummary }>> {
  const clean: Partial<Record<(typeof DENOMINATIONS)[number], number>> = {};
  for (const d of DENOMINATIONS) clean[d] = Math.max(0, Math.floor(Number(counts[String(d)] ?? 0)));
  return guard(() =>
    withSession("till.sell", async () => {
      const shiftId = await currentShiftId(registerId);
      const summary = await shiftSummary(db, shiftId);
      const r = await db.transaction(async (tx) => {
        const res = await closeShift(tx, { shiftId, counts: clean, date: nairobiDate() });
        await audit(tx, { action: "shift.close", entity: "shift", entityId: shiftId, after: res });
        return res;
      });
      return { ...r, summary };
    })
  );
}

/* ---------------- Owner PIN ---------------- */

async function approver(pin: string | undefined, role: string): Promise<number | null> {
  if (role === "owner") return null;
  return pin ? verifyOwnerPin(pin) : null;
}

/* ---------------- Sale ---------------- */

const CheckoutInput = z.object({
  idempotencyKey: z.string().min(8).max(64),
  registerId: z.number().int(),
  customerId: z.number().int(),
  lines: z.array(z.object({ variantId: z.number().int(), qty: z.number().int().min(1).max(10_000), manualDiscountCents: z.number().int().min(0) })).min(1).max(200),
  cartDiscountCents: z.number().int().min(0),
  payments: z.array(z.object({
    method: z.enum(["cash", "mpesa", "credit", "points", "exchange"]),
    amountCents: z.number().int().min(1),
    tenderedCents: z.number().int().min(0).optional(),
    mpesaCode: z.string().max(12).optional(),
    returnId: z.number().int().optional(),
  })).min(1).max(5),
  ownerPin: z.string().max(6).optional(),
});

export async function completeSale(raw: z.infer<typeof CheckoutInput>): Promise<Result<CheckoutResult>> {
  const parsed = CheckoutInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "The sale data was incomplete. Try again." };
  const { ownerPin, ...input } = parsed.data;
  const res = await guard(() =>
    withSession("till.sell", async (s) => {
      const discountApprovedBy = await approver(ownerPin, s.role);
      const run = () => db.transaction((tx) => checkout(tx, { ...input, discountApprovedBy, businessDate: nairobiDate() }));
      try {
        return await run();
      } catch (e) {
        const pg = pgError(e);
        // Two submits of the same sale raced: the loser hits the unique key — return the winner.
        if (pg.code === "23505" && pg.constraint === "uq_sales_org_idem") return run();
        if (pg.code === "23505" && pg.constraint === "uq_sale_payments_org_mpesa") throw new CheckoutError("That M-Pesa code was just used on another sale.");
        throw e;
      }
    })
  );
  // Receipt by SMS after the sale is safely saved; never blocks the till.
  if (res.ok && !res.data.replayed) void sendSaleReceiptSms(res.data.saleId).catch((e) => console.error("SMS receipt failed", e));
  return res;
}

/* ---------------- Returns ---------------- */

export interface ReturnableSale {
  saleId: number;
  receiptNo: string;
  createdAt: string;
  customer: TillCustomer;
  lines: { saleLineId: number; description: string; qty: number; returnable: number; unitPaidCents: number }[];
  exchangeCredits: { returnId: number; returnNo: string; creditLeftCents: number }[];
}

/** Find a sale by receipt number, or the customer's latest sales by phone. */
export async function findSale(query: string): Promise<Result<ReturnableSale[]>> {
  return guard(() =>
    withSession("till.sell", async (s) => {
      const q = query.trim().toUpperCase();
      const phone = normalizeKenyanPhone(query);
      let rows: (typeof sales.$inferSelect)[] = [];
      if (/^KF-?\d+$/.test(q)) {
        const no = `KF-${q.replace(/\D/g, "").padStart(6, "0")}`;
        rows = await db.select().from(sales).where(and(eq(sales.orgId, s.org.id), eq(sales.receiptNo, no))).limit(1);
      } else if (phone) {
        const [c] = await db.select().from(customers).where(and(eq(customers.orgId, s.org.id), eq(customers.phone, phone))).limit(1);
        if (c) rows = await db.select().from(sales).where(and(eq(sales.orgId, s.org.id), eq(sales.customerId, c.id))).orderBy(desc(sales.createdAt)).limit(5);
      } else {
        throw new ReturnError("Type the receipt number (e.g. KF-000123) or the customer's phone.");
      }
      const out: ReturnableSale[] = [];
      for (const sale of rows) {
        const [c] = await db.select().from(customers).where(eq(customers.id, sale.customerId));
        const lines = await db.select().from(saleLines).where(eq(saleLines.saleId, sale.id)).orderBy(saleLines.id);
        const credits = await db
          .select()
          .from(saleReturns)
          .where(and(eq(saleReturns.orgId, s.org.id), eq(saleReturns.customerId, sale.customerId), eq(saleReturns.kind, "exchange")));
        out.push({
          saleId: sale.id,
          receiptNo: sale.receiptNo,
          createdAt: sale.createdAt.toISOString(),
          customer: await toTillCustomer(c),
          lines: lines.map((l) => ({ saleLineId: l.id, description: l.description, qty: l.qty, returnable: l.qty - l.returnedQty, unitPaidCents: Math.round(l.lineTotalCents / l.qty) })),
          exchangeCredits: credits.filter((r) => r.creditLeftCents > 0).map((r) => ({ returnId: r.id, returnNo: r.returnNo, creditLeftCents: r.creditLeftCents })),
        });
      }
      return out;
    })
  );
}

const ReturnInput = z.object({
  idempotencyKey: z.string().min(8).max(64),
  registerId: z.number().int(),
  saleId: z.number().int(),
  kind: z.enum(["exchange", "refund"]),
  refundMethod: z.enum(["cash", "mpesa", "credit", "points"]).optional(),
  lines: z.array(z.object({ saleLineId: z.number().int(), qty: z.number().int().min(1) })).min(1),
  unopenedConfirmed: z.literal(true),
  ownerPin: z.string().max(6).optional(),
});

export async function returnItems(raw: z.infer<typeof ReturnInput>): Promise<Result<{ returnId: number; returnNo: string; totalCents: number; creditCents: number }>> {
  const parsed = ReturnInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Tick “unopened” for every item and pick at least one." };
  const { ownerPin, ...input } = parsed.data;
  return guard(() =>
    withSession("till.sell", async (s) => {
      const approvedBy = await approver(ownerPin, s.role);
      return db.transaction(async (tx) => {
        const r = await processReturn(tx, { ...input, approvedBy, businessDate: nairobiDate() });
        if (!r.replayed) await audit(tx, { action: input.kind === "refund" ? "sale.refund" : "sale.exchange", entity: "sale_return", entityId: r.returnId, after: { ...input, approvedBy } });
        return r;
      });
    })
  );
}

export async function payOutExchangeCredit(returnId: number, method: "cash" | "mpesa", ownerPin?: string): Promise<Result<number>> {
  return guard(() =>
    withSession("till.sell", async (s) => {
      const approvedBy = await approver(ownerPin, s.role);
      return db.transaction(async (tx) => {
        const amount = await refundExchangeCredit(tx, { returnId, method, approvedBy, date: nairobiDate() });
        await audit(tx, { action: "exchange.payout", entity: "sale_return", entityId: returnId, after: { amount, method, approvedBy } });
        return amount;
      });
    })
  );
}

/* ---------------- Credit account payments ---------------- */

export async function payOnAccount(registerId: number, input: { customerId: number; amountCents: number; method: "cash" | "mpesa"; mpesaCode?: string }): Promise<Result<TillCustomer>> {
  return guard(() =>
    withSession("till.sell", async (s) => {
      const shiftId = await currentShiftId(registerId);
      await db.transaction(async (tx) => {
        const id = await receiveCustomerPayment(tx, { ...input, shiftId, date: nairobiDate() });
        await audit(tx, { action: "customer.payment", entity: "customer_payment", entityId: id, after: input });
      });
      const [c] = await db.select().from(customers).where(and(eq(customers.orgId, s.org.id), eq(customers.id, input.customerId))).limit(1);
      return toTillCustomer(c);
    })
  );
}
