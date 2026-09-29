"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, registers } from "@/db";
import { audit, ForbiddenError, withSession } from "@/lib/auth";
import { checkout, CheckoutError, type CheckoutResult } from "@/lib/checkout";
import { createCustomer, creditOwedCents, CustomerError, earnsPoints, findCustomerByPhone, type Customer } from "@/lib/customers";
import { openShift, ShiftError } from "@/lib/shifts";
import { nairobiDate } from "@/lib/time";
import { maskPhone } from "@/lib/phone";

export interface TillCustomer {
  id: number;
  name: string | null;
  phoneMasked: string;
  type: "retail" | "wholesale";
  businessName: string | null;
  earnsPoints: boolean;
  pointsBalance: number;
  creditEnabled: boolean;
  creditAvailableCents: number;
}

async function toTillCustomer(c: Customer): Promise<TillCustomer> {
  const owed = c.creditEnabled ? await creditOwedCents(db, c.id) : 0;
  return {
    id: c.id,
    name: c.name,
    phoneMasked: maskPhone(c.phone),
    type: c.type as "retail" | "wholesale",
    businessName: c.businessName,
    earnsPoints: earnsPoints(c),
    pointsBalance: c.pointsBalance,
    creditEnabled: c.creditEnabled,
    creditAvailableCents: c.creditEnabled ? Math.max(0, c.creditLimitCents - owed) : 0,
  };
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const KNOWN = [CheckoutError, CustomerError, ShiftError, ForbiddenError];
async function guard<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (KNOWN.some((K) => e instanceof K)) return { ok: false, error: (e as Error).message };
    console.error(e);
    return { ok: false, error: "Something went wrong — the sale was not saved. Try again." };
  }
}

export async function lookupCustomer(phone: string): Promise<Result<TillCustomer | null>> {
  return guard(() =>
    withSession("customers.view", async () => {
      const c = await findCustomerByPhone(db, phone);
      return c ? toTillCustomer(c) : null;
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

const CheckoutInput = z.object({
  idempotencyKey: z.string().min(8).max(64),
  registerId: z.number().int(),
  customerId: z.number().int(),
  lines: z.array(z.object({ variantId: z.number().int(), qty: z.number().int().min(1).max(10_000), manualDiscountCents: z.number().int().min(0) })).min(1).max(200),
  cartDiscountCents: z.number().int().min(0),
  payments: z.array(z.object({
    method: z.enum(["cash", "mpesa", "credit"]),
    amountCents: z.number().int().min(1),
    tenderedCents: z.number().int().min(0).optional(),
    mpesaCode: z.string().max(12).optional(),
  })).min(1).max(4),
});

export async function completeSale(raw: z.infer<typeof CheckoutInput>): Promise<Result<CheckoutResult>> {
  const parsed = CheckoutInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "The sale data was incomplete. Try again." };
  const input = parsed.data;
  return guard(() =>
    withSession("till.sell", async () => {
      try {
        return await db.transaction((tx) => checkout(tx, { ...input, businessDate: nairobiDate() }));
      } catch (e) {
        // Two submits of the same sale raced: the loser hits the unique key — return the winner.
        const pg = pgError(e);
        if (pg.code === "23505" && pg.constraint === "uq_sales_org_idem") {
          return db.transaction((tx) => checkout(tx, { ...input, businessDate: nairobiDate() }));
        }
        if (pg.code === "23505" && pg.constraint === "uq_sale_payments_org_mpesa") {
          throw new CheckoutError("That M-Pesa code was just used on another sale.");
        }
        throw e;
      }
    })
  );
}

/** Postgres errors arrive either raw (postgres-js) or wrapped by Drizzle in `.cause`. */
function pgError(e: unknown): { code?: string; constraint?: string } {
  const c = ((e as { cause?: unknown }).cause ?? e) as { code?: string; constraint_name?: string };
  return { code: c.code, constraint: c.constraint_name };
}
