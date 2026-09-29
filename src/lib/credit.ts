import { and, asc, eq, sql } from "drizzle-orm";
import { accounts, customerPayments, customers, journalEntries, journalLines, type DbOrTx, type Tx } from "@/db";
import { SYS } from "./coa";
import { ctx } from "./context";
import { creditOwedCents } from "./customers";
import { acct, postEntry } from "./ledger";
import { MPESA_CODE } from "./checkout";

/** Credit accounts: salons, wholesale and trusted retail customers buying on account. */

export class CreditError extends Error {}

export async function setCreditTerms(tx: Tx, p: { customerId: number; enabled: boolean; limitCents: number; termsDays: number; type?: "retail" | "wholesale"; businessName?: string | null }) {
  const { orgId, role } = ctx();
  if (role !== "owner") throw new CreditError("Only the owner can change credit.");
  if (!Number.isInteger(p.limitCents) || p.limitCents < 0) throw new CreditError("Enter a valid credit limit.");
  if (!Number.isInteger(p.termsDays) || p.termsDays < 0 || p.termsDays > 365) throw new CreditError("Terms are 0 to 365 days.");
  const [c] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.orgId, orgId), eq(customers.id, p.customerId))).limit(1);
  if (!c) throw new CreditError("Customer not found.");
  await tx
    .update(customers)
    .set({ creditEnabled: p.enabled, creditLimitCents: p.limitCents, creditTermsDays: p.termsDays, ...(p.type ? { type: p.type } : {}), ...(p.businessName !== undefined ? { businessName: p.businessName } : {}) })
    .where(eq(customers.id, c.id));
}

/**
 * Money from a credit customer. At the till (shift open) cash goes into the
 * drawer; otherwise into Cash at Hand, M-Pesa or Bank. Dr money / Cr AR.
 */
export async function receiveCustomerPayment(
  tx: Tx,
  p: { customerId: number; amountCents: number; method: "cash" | "mpesa" | "bank"; mpesaCode?: string | null; reference?: string | null; shiftId?: number | null; date: string }
): Promise<number> {
  const { orgId, memberId } = ctx();
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) throw new CreditError("Enter an amount above zero.");
  const [c] = await tx.select().from(customers).where(and(eq(customers.orgId, orgId), eq(customers.id, p.customerId))).for("update");
  if (!c) throw new CreditError("Customer not found.");
  const owed = await creditOwedCents(tx, c.id);
  if (p.amountCents > owed) throw new CreditError(`They only owe KES ${(owed / 100).toLocaleString("en-KE", { minimumFractionDigits: 2 })}.`);
  let code: string | null = null;
  if (p.method === "mpesa") {
    code = (p.mpesaCode ?? "").trim().toUpperCase();
    if (!MPESA_CODE.test(code)) throw new CreditError("An M-Pesa code is 10 letters and numbers.");
    const [dupe] = await tx.execute<{ n: number }>(sql`select (select count(*) from sale_payments where org_id = ${orgId} and mpesa_code = ${code}) + (select count(*) from customer_payments where org_id = ${orgId} and mpesa_code = ${code}) as n`);
    if (Number(dupe.n) > 0) throw new CreditError(`M-Pesa code ${code} was already used.`);
  }
  const moneyAccount = p.method === "cash" ? (p.shiftId ? SYS.CASH_DRAWER : SYS.CASH_AT_HAND) : p.method === "mpesa" ? SYS.MPESA_TILL : SYS.BANK;
  const [row] = await tx
    .insert(customerPayments)
    .values({ orgId, customerId: c.id, date: p.date, amountCents: p.amountCents, method: p.method, mpesaCode: code, reference: p.reference ?? null, shiftId: p.shiftId ?? null, memberId })
    .returning({ id: customerPayments.id });
  const entryId = await postEntry(tx, {
    date: p.date,
    memo: `Payment on account${code ? ` ${code}` : ""}`,
    sourceType: "customer_payment",
    sourceId: row.id,
    lines: [
      { accountId: await acct(tx, moneyAccount), debitCents: p.amountCents, memo: code ?? p.reference ?? undefined },
      { accountId: await acct(tx, SYS.AR), creditCents: p.amountCents, customerId: c.id },
    ],
  });
  await tx.update(customerPayments).set({ journalEntryId: entryId }).where(eq(customerPayments.id, row.id));
  return row.id;
}

export interface StatementLine {
  date: string;
  description: string;
  chargeCents: number;
  paymentCents: number;
  balanceCents: number;
}

/** Account statement from the ledger: opening balance, every sale on account and payment, running balance. */
export async function customerStatement(db: DbOrTx, customerId: number, from: string, to: string): Promise<{ openingCents: number; lines: StatementLine[]; closingCents: number }> {
  const { orgId } = ctx();
  const rows = await db
    .select({ date: journalEntries.date, memo: journalEntries.memo, dr: journalLines.debitCents, cr: journalLines.creditCents })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalLines.orgId, orgId), eq(journalLines.customerId, customerId), eq(accounts.code, SYS.AR), sql`${journalEntries.date} <= ${to}`))
    .orderBy(asc(journalEntries.date), asc(journalEntries.id));
  let opening = 0;
  let bal = 0;
  const lines: StatementLine[] = [];
  for (const r of rows) {
    bal += r.dr - r.cr;
    if (r.date < from) {
      opening = bal;
      continue;
    }
    lines.push({ date: r.date, description: r.memo ?? "", chargeCents: r.dr, paymentCents: r.cr, balanceCents: bal });
  }
  return { openingCents: opening, lines, closingCents: bal };
}

/** Oldest unpaid charges first — for the aging buckets on the customers page. */
export async function agingBuckets(db: DbOrTx, customerId: number, today: string): Promise<{ current: number; d31_60: number; d61_90: number; over90: number }> {
  const { lines, closingCents } = await customerStatement(db, customerId, "1900-01-01", today);
  let remaining = closingCents;
  const out = { current: 0, d31_60: 0, d61_90: 0, over90: 0 };
  // Payments clear the oldest charges; what's left is aged from the newest charges backwards.
  for (const l of [...lines].reverse()) {
    if (remaining <= 0) break;
    if (l.chargeCents <= 0) continue;
    const part = Math.min(l.chargeCents, remaining);
    remaining -= part;
    const age = (Date.parse(today) - Date.parse(l.date)) / 86_400_000;
    if (age <= 30) out.current += part;
    else if (age <= 60) out.d31_60 += part;
    else if (age <= 90) out.d61_90 += part;
    else out.over90 += part;
  }
  return out;
}
