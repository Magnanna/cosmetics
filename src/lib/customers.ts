import { and, eq, sql } from "drizzle-orm";
import { accounts, customers, journalLines, type DbOrTx } from "@/db";
import { SYS } from "./coa";
import { ctx } from "./context";
import { normalizeKenyanPhone } from "./phone";

export class CustomerError extends Error {}

export type Customer = typeof customers.$inferSelect;

export async function findCustomerByPhone(db: DbOrTx, rawPhone: string): Promise<Customer | null> {
  const phone = normalizeKenyanPhone(rawPhone);
  if (!phone) return null;
  const [row] = await db.select().from(customers).where(and(eq(customers.orgId, ctx().orgId), eq(customers.phone, phone))).limit(1);
  return row ?? null;
}

export async function createCustomer(
  db: DbOrTx,
  p: { phone: string; name?: string | null; type?: "retail" | "wholesale"; businessName?: string | null; marketingConsent: boolean }
): Promise<Customer> {
  const phone = normalizeKenyanPhone(p.phone);
  if (!phone) throw new CustomerError("That isn't a valid Kenyan mobile number.");
  const [row] = await db
    .insert(customers)
    .values({
      orgId: ctx().orgId,
      phone,
      name: p.name?.trim() || null,
      type: p.type ?? "retail",
      businessName: p.businessName?.trim() || null,
      marketingConsent: p.marketingConsent,
      consentAt: p.marketingConsent ? new Date() : null,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) throw new CustomerError("A customer with that number already exists.");
  return row;
}

/** What the customer owes on their credit account (Accounts Receivable balance). */
export async function creditOwedCents(db: DbOrTx, customerId: number): Promise<number> {
  const { orgId } = ctx();
  const [row] = await db
    .select({ bal: sql<string>`coalesce(sum(${journalLines.debitCents} - ${journalLines.creditCents}), 0)` })
    .from(journalLines)
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .where(and(eq(journalLines.orgId, orgId), eq(journalLines.customerId, customerId), eq(accounts.code, SYS.AR)));
  return Number(row.bal);
}

/** Retail customers earn points by default, wholesale don't, unless overridden per customer. */
export function earnsPoints(c: Pick<Customer, "type" | "earnsPointsOverride">): boolean {
  return c.earnsPointsOverride ?? c.type === "retail";
}
