"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { audit, ForbiddenError, withSession } from "@/lib/auth";
import { CreditError, receiveCustomerPayment, setCreditTerms } from "@/lib/credit";
import { nairobiDate } from "@/lib/time";

const Terms = z.object({
  customerId: z.coerce.number().int(),
  type: z.enum(["retail", "wholesale"]),
  businessName: z.string().trim().max(80).optional(),
  enabled: z.enum(["on", "off"]).optional(),
  limit: z.coerce.number().min(0),
  termsDays: z.coerce.number().int().min(0).max(365),
});

export async function saveCredit(_: unknown, form: FormData): Promise<{ error?: string; ok?: boolean }> {
  const parsed = Terms.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const v = parsed.data;
  try {
    await withSession("customers.credit", () =>
      db.transaction(async (tx) => {
        await setCreditTerms(tx, { customerId: v.customerId, enabled: v.enabled === "on", limitCents: Math.round(v.limit * 100), termsDays: v.termsDays, type: v.type, businessName: v.businessName || null });
        await audit(tx, { action: "customer.credit_terms", entity: "customer", entityId: v.customerId, after: v });
      })
    );
  } catch (e) {
    if (e instanceof CreditError || e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/customers/${v.customerId}`);
  return { ok: true };
}

const Payment = z.object({
  customerId: z.coerce.number().int(),
  amount: z.coerce.number().positive("Enter an amount."),
  method: z.enum(["cash", "mpesa", "bank"]),
  mpesaCode: z.string().trim().max(12).optional(),
  reference: z.string().trim().max(60).optional(),
});

export async function recordPayment(_: unknown, form: FormData): Promise<{ error?: string; ok?: boolean }> {
  const parsed = Payment.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const v = parsed.data;
  try {
    await withSession("books.post", () =>
      db.transaction(async (tx) => {
        const id = await receiveCustomerPayment(tx, { customerId: v.customerId, amountCents: Math.round(v.amount * 100), method: v.method, mpesaCode: v.mpesaCode, reference: v.reference, date: nairobiDate() });
        await audit(tx, { action: "customer.payment", entity: "customer_payment", entityId: id, after: v });
      })
    );
  } catch (e) {
    if (e instanceof CreditError || e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/customers/${v.customerId}`);
  return { ok: true };
}
