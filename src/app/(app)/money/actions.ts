"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, orgs } from "@/db";
import { audit, ForbiddenError, withSession } from "@/lib/auth";
import { BooksLockedError, UnbalancedEntryError } from "@/lib/ledger";
import { manualJournal, MoneyError, payTurnoverTax, postTurnoverTax, recordExpense, transferMoney } from "@/lib/money-ops";
import { importStatement } from "@/lib/mpesa-reconcile";
import { parseMpesaStatement, StatementError } from "@/lib/mpesa-statement";

type State = { error?: string; ok?: string };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const money = z.coerce.number().positive("Enter an amount above zero.");
const known = (e: unknown) =>
  e instanceof MoneyError || e instanceof ForbiddenError || e instanceof BooksLockedError || e instanceof UnbalancedEntryError || e instanceof StatementError ? (e as Error).message : null;

async function run(perm: Parameters<typeof withSession>[0], fn: () => Promise<string>, paths: string[]): Promise<State> {
  try {
    const ok = await withSession(perm, fn);
    paths.forEach((p) => revalidatePath(p));
    return { ok };
  } catch (e) {
    const m = known(e);
    if (m) return { error: m };
    throw e;
  }
}

const Expense = z.object({ date, accountId: z.coerce.number().int(), amount: money, paidFrom: z.enum(["cash_at_hand", "mpesa", "bank"]), description: z.string().trim().min(1, "Say what it was for.").max(200), reference: z.string().trim().max(60).optional() });
export async function addExpense(_: unknown, form: FormData): Promise<State> {
  const p = Expense.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const v = p.data;
  return run("books.post", () => db.transaction(async (tx) => {
    const id = await recordExpense(tx, { ...v, amountCents: Math.round(v.amount * 100) });
    await audit(tx, { action: "expense.create", entity: "expense", entityId: id, after: v });
    return "Expense saved.";
  }), ["/money/expenses", "/reports/pnl"]);
}

const Transfer = z.object({ date, from: z.enum(["cash_at_hand", "mpesa", "bank"]), to: z.enum(["cash_at_hand", "mpesa", "bank"]), amount: money, fee: z.coerce.number().min(0).optional(), note: z.string().trim().max(120).optional() });
export async function addTransfer(_: unknown, form: FormData): Promise<State> {
  const p = Transfer.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const v = p.data;
  return run("books.post", () => db.transaction(async (tx) => {
    const id = await transferMoney(tx, { date: v.date, from: v.from, to: v.to, amountCents: Math.round(v.amount * 100), feeCents: Math.round((v.fee ?? 0) * 100), note: v.note });
    await audit(tx, { action: "transfer.create", entity: "money_transfer", entityId: id, after: v });
    return "Transfer saved.";
  }), ["/money/transfers"]);
}

const Journal = z.object({ date, memo: z.string().trim().min(1).max(200), lines: z.array(z.object({ accountId: z.number().int(), debitCents: z.number().int().min(0), creditCents: z.number().int().min(0) })).min(2) });
export async function postJournal(raw: z.infer<typeof Journal>): Promise<State> {
  const p = Journal.safeParse(raw);
  if (!p.success) return { error: "Fill in the date, a note and at least two lines." };
  return run("books.post", () => db.transaction(async (tx) => {
    const id = await manualJournal(tx, p.data);
    await audit(tx, { action: "journal.post", entity: "journal_entry", entityId: id, after: p.data });
    return "Journal posted.";
  }), ["/money/journal", "/books/accounts"]);
}

export async function recordTot(month: string): Promise<State> {
  return run("books.post", () => db.transaction(async (tx) => {
    const id = await postTurnoverTax(tx, month);
    await audit(tx, { action: "tot.accrue", entity: "journal_entry", entityId: id, after: { month } });
    return `Turnover Tax for ${month} recorded.`;
  }), ["/reports/tot"]);
}

const TotPay = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), date, amount: money, paidFrom: z.enum(["cash_at_hand", "mpesa", "bank"]), reference: z.string().trim().max(60).optional() });
export async function payTot(_: unknown, form: FormData): Promise<State> {
  const p = TotPay.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const v = p.data;
  return run("books.post", () => db.transaction(async (tx) => {
    const id = await payTurnoverTax(tx, { month: v.month, date: v.date, amountCents: Math.round(v.amount * 100), paidFrom: v.paidFrom, reference: v.reference });
    await audit(tx, { action: "tot.pay", entity: "journal_entry", entityId: id, after: v });
    return "Payment recorded.";
  }), ["/reports/tot"]);
}

export async function uploadMpesaStatement(_: unknown, form: FormData): Promise<State> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the CSV file you exported from the M-Pesa portal." };
  if (file.size > 5 * 1024 * 1024) return { error: "That file is too big (5 MB max)." };
  return run("books.view", async () => {
    const lines = parseMpesaStatement(await file.text());
    const r = await db.transaction(async (tx) => {
      const res = await importStatement(tx, file.name, lines);
      await audit(tx, { action: "mpesa.import", entity: "mpesa_import", entityId: res.importId, after: res });
      return res;
    });
    return `Imported ${lines.length} lines: ${r.matched} matched, ${r.amount_mismatch} wrong amount, ${r.not_in_pos} not recorded at the till, ${r.withdrawal} withdrawals${r.skipped ? `, ${r.skipped} already imported` : ""}.`;
  }, ["/money/mpesa"]);
}

export async function setLockDate(_: unknown, form: FormData): Promise<State> {
  const raw = String(form.get("lockDate") ?? "").trim();
  if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { error: "Pick a date." };
  return run("books.lock", async () => {
    const s = await withSession("books.lock", async (s) => s);
    await db.transaction(async (tx) => {
      const [before] = await tx.select({ lockDate: orgs.lockDate }).from(orgs).where(eq(orgs.id, s.org.id));
      await tx.update(orgs).set({ lockDate: raw || null }).where(eq(orgs.id, s.org.id));
      await audit(tx, { action: "books.lock", entity: "org", entityId: s.org.id, before, after: { lockDate: raw || null } });
    });
    return raw ? `Books closed up to ${raw}.` : "Books reopened.";
  }, ["/settings/books"]);
}
