"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, orgs } from "@/db";
import { audit, ForbiddenError, withSession } from "@/lib/auth";
import type { Role } from "@/lib/context";
import { BooksLockedError } from "@/lib/ledger";
import { openingCustomerDebt, openingMoney, OpeningError, openingSupplierDebt } from "@/lib/opening";
import { normalizeKenyanPhone } from "@/lib/phone";
import { addStaff, TeamError, updateStaff } from "@/lib/team";

type State = { error?: string; ok?: string };
const known = (e: unknown) => (e instanceof TeamError || e instanceof ForbiddenError || e instanceof OpeningError || e instanceof BooksLockedError ? (e as Error).message : null);

const Shop = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().max(20).optional(),
  address: z.string().trim().max(160).optional(),
  kraPin: z.string().trim().max(20).optional(),
  receiptFooter: z.string().trim().max(200).optional(),
  cashierDiscountLimit: z.coerce.number().min(0).max(100_000),
  returnWindowHours: z.coerce.number().int().min(0).max(720),
  loyaltyEarnKes: z.coerce.number().min(1).max(10_000),
  loyaltyPointValue: z.coerce.number().min(0.01).max(100),
  loyaltyMinRedeem: z.coerce.number().min(0).max(100_000),
  totRatePct: z.coerce.number().min(0).max(10),
});

export async function saveShop(_: unknown, form: FormData): Promise<State> {
  const p = Shop.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: `${p.error.issues[0]?.path.join(".")}: ${p.error.issues[0]?.message}` };
  const v = p.data;
  const phone = v.phone ? normalizeKenyanPhone(v.phone) : null;
  if (v.phone && !phone) return { error: "The shop phone should be a Kenyan mobile — it gets the owner's daily summary SMS." };
  try {
    await withSession("settings.edit", (s) =>
      db.transaction(async (tx) => {
        const values = {
          name: v.name, phone, address: v.address || null, kraPin: v.kraPin?.toUpperCase() || null, receiptFooter: v.receiptFooter || null,
          cashierDiscountLimitCents: Math.round(v.cashierDiscountLimit * 100), returnWindowHours: v.returnWindowHours,
          loyaltyEarnCentsPerPoint: Math.round(v.loyaltyEarnKes * 100), loyaltyPointValueCents: Math.round(v.loyaltyPointValue * 100),
          loyaltyMinRedeemCents: Math.round(v.loyaltyMinRedeem * 100), totRateBp: Math.round(v.totRatePct * 100),
        };
        await tx.update(orgs).set(values).where(eq(orgs.id, s.org.id));
        await audit(tx, { action: "settings.update", entity: "org", entityId: s.org.id, before: s.org, after: values });
      })
    );
  } catch (e) {
    const m = known(e);
    if (m) return { error: m };
    throw e;
  }
  revalidatePath("/", "layout");
  return { ok: "Saved." };
}

const Staff = z.object({ name: z.string().trim().min(1), email: z.string().trim().email("Enter a valid email."), password: z.string().min(10, "Starting password: at least 10 characters."), role: z.enum(["owner", "accountant", "staff", "cashier"]) });
export async function addStaffMember(_: unknown, form: FormData): Promise<State> {
  const p = Staff.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  try {
    await withSession("team.manage", async () => {
      const id = await addStaff(p.data);
      await db.transaction((tx) => audit(tx, { action: "team.add", entity: "member", entityId: id, after: { name: p.data.name, email: p.data.email, role: p.data.role } }));
    });
  } catch (e) {
    const m = known(e);
    if (m) return { error: m };
    throw e;
  }
  revalidatePath("/settings/team");
  return { ok: `${p.data.name} can now sign in with ${p.data.email}.` };
}

export async function changeStaff(memberId: number, patch: { role?: Role; active?: boolean }): Promise<State> {
  try {
    await withSession("team.manage", async () => {
      await updateStaff(memberId, patch);
      await db.transaction((tx) => audit(tx, { action: "team.update", entity: "member", entityId: memberId, after: patch }));
    });
  } catch (e) {
    const m = known(e);
    if (m) return { error: m };
    throw e;
  }
  revalidatePath("/settings/team");
  return { ok: "Updated." };
}

const Opening = z.object({
  kind: z.enum(["money", "supplier", "customer"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  account: z.enum(["cash_at_hand", "mpesa", "bank"]).optional(),
  supplierId: z.coerce.number().int().optional(),
  customerId: z.coerce.number().int().optional(),
  reference: z.string().trim().max(60).optional(),
  amount: z.coerce.number().positive("Enter an amount."),
});
export async function addOpening(_: unknown, form: FormData): Promise<State> {
  const p = Opening.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const v = p.data;
  const cents = Math.round(v.amount * 100);
  try {
    await withSession("books.post", () =>
      db.transaction(async (tx) => {
        if (v.kind === "money") await openingMoney(tx, { date: v.date, account: v.account!, amountCents: cents });
        else if (v.kind === "supplier") await openingSupplierDebt(tx, { date: v.date, supplierId: v.supplierId!, amountCents: cents, reference: v.reference ?? "" });
        else await openingCustomerDebt(tx, { date: v.date, customerId: v.customerId!, amountCents: cents });
        await audit(tx, { action: "opening.add", entity: "opening_balance", after: v });
      })
    );
  } catch (e) {
    const m = known(e);
    if (m) return { error: m };
    throw e;
  }
  revalidatePath("/settings/opening");
  return { ok: "Opening balance saved." };
}
