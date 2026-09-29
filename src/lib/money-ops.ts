import { and, eq } from "drizzle-orm";
import { accounts, expenses, moneyTransfers, type Tx } from "@/db";
import { SYS } from "./coa";
import { ctx } from "./context";
import { acct, postEntry, type PostLine } from "./ledger";
import { monthRange, totForMonth } from "./reports";

/** Back-office money: expenses, transfers, Turnover Tax, manual journals, books lock. */

export class MoneyError extends Error {}

export const MONEY_ACCOUNTS = {
  cash_at_hand: { code: SYS.CASH_AT_HAND, label: "Cash at hand" },
  mpesa: { code: SYS.MPESA_TILL, label: "M-Pesa" },
  bank: { code: SYS.BANK, label: "Bank" },
} as const;
export type MoneyAccount = keyof typeof MONEY_ACCOUNTS;

async function expenseAccount(tx: Tx, accountId: number) {
  const [a] = await tx.select().from(accounts).where(and(eq(accounts.orgId, ctx().orgId), eq(accounts.id, accountId))).limit(1);
  if (!a || a.type !== "expense" || a.subtype === "cogs") throw new MoneyError("Pick an expense category.");
  return a;
}

export async function recordExpense(
  tx: Tx,
  p: { date: string; accountId: number; amountCents: number; paidFrom: MoneyAccount; description: string; reference?: string | null }
): Promise<number> {
  const { orgId, memberId } = ctx();
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) throw new MoneyError("Enter an amount above zero.");
  if (!p.description.trim()) throw new MoneyError("Say what it was for.");
  if (!MONEY_ACCOUNTS[p.paidFrom]) throw new MoneyError("Choose where the money came from.");
  const a = await expenseAccount(tx, p.accountId);
  const [row] = await tx
    .insert(expenses)
    .values({ orgId, date: p.date, accountId: a.id, amountCents: p.amountCents, paidFrom: p.paidFrom, description: p.description.trim(), reference: p.reference?.trim() || null, memberId })
    .returning({ id: expenses.id });
  const entryId = await postEntry(tx, {
    date: p.date,
    memo: `${a.name}: ${p.description.trim()}`,
    sourceType: "expense",
    sourceId: row.id,
    lines: [
      { accountId: a.id, debitCents: p.amountCents, memo: p.reference ?? undefined },
      { accountId: await acct(tx, MONEY_ACCOUNTS[p.paidFrom].code), creditCents: p.amountCents },
    ],
  });
  await tx.update(expenses).set({ journalEntryId: entryId }).where(eq(expenses.id, row.id));
  return row.id;
}

/** e.g. banking cash at hand, or withdrawing M-Pesa to the bank. Any fee is a bank-charges expense. */
export async function transferMoney(tx: Tx, p: { date: string; from: MoneyAccount; to: MoneyAccount; amountCents: number; feeCents?: number; note?: string | null }): Promise<number> {
  const { orgId, memberId } = ctx();
  if (p.from === p.to) throw new MoneyError("Pick two different places.");
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) throw new MoneyError("Enter an amount above zero.");
  const fee = p.feeCents ?? 0;
  if (!Number.isInteger(fee) || fee < 0) throw new MoneyError("The fee can't be negative.");
  const [row] = await tx
    .insert(moneyTransfers)
    .values({ orgId, date: p.date, fromCode: MONEY_ACCOUNTS[p.from].code, toCode: MONEY_ACCOUNTS[p.to].code, amountCents: p.amountCents, feeCents: fee, note: p.note ?? null, memberId })
    .returning({ id: moneyTransfers.id });
  const lines: PostLine[] = [
    { accountId: await acct(tx, MONEY_ACCOUNTS[p.to].code), debitCents: p.amountCents },
    { accountId: await acct(tx, MONEY_ACCOUNTS[p.from].code), creditCents: p.amountCents + fee },
  ];
  if (fee) {
    const [charges] = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.orgId, orgId), eq(accounts.code, "6070"))).limit(1);
    lines.push({ accountId: charges?.id ?? (await acct(tx, SYS.OTHER_EXPENSE)), debitCents: fee, memo: "Transfer fee" });
  }
  const entryId = await postEntry(tx, { date: p.date, memo: `${MONEY_ACCOUNTS[p.from].label} → ${MONEY_ACCOUNTS[p.to].label}${p.note ? `: ${p.note}` : ""}`, sourceType: "transfer", sourceId: row.id, lines });
  await tx.update(moneyTransfers).set({ journalEntryId: entryId }).where(eq(moneyTransfers.id, row.id));
  return row.id;
}

/** Records the month's Turnover Tax as owed: Dr TOT Expense / Cr TOT Payable, dated the month's last day. Once per month. */
export async function postTurnoverTax(tx: Tx, month: string): Promise<number> {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new MoneyError("Pick a month.");
  const t = await totForMonth(tx, month);
  if (t.postedEntryId) throw new MoneyError("This month's Turnover Tax is already recorded.");
  if (t.taxCents <= 0) throw new MoneyError("No turnover this month, so there's no tax to record.");
  const { to } = monthRange(month);
  return postEntry(tx, {
    date: to,
    memo: `Turnover Tax ${month} (${t.rateBp / 100}% of KES ${(t.turnoverCents / 100).toLocaleString("en-KE")})`,
    sourceType: "tot_accrual",
    sourceId: Number(month.replace("-", "")),
    lines: [
      { accountId: await acct(tx, SYS.TOT_EXPENSE), debitCents: t.taxCents },
      { accountId: await acct(tx, SYS.TOT_PAYABLE), creditCents: t.taxCents },
    ],
  });
}

export async function payTurnoverTax(tx: Tx, p: { month: string; date: string; amountCents: number; paidFrom: MoneyAccount; reference?: string | null }): Promise<number> {
  const t = await totForMonth(tx, p.month);
  if (!t.postedEntryId) throw new MoneyError("Record the month's tax before paying it.");
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) throw new MoneyError("Enter an amount above zero.");
  if (p.amountCents > t.postedCents - t.paidCents) throw new MoneyError(`Only KES ${((t.postedCents - t.paidCents) / 100).toLocaleString("en-KE")} is owed for ${p.month}.`);
  return postEntry(tx, {
    date: p.date,
    memo: `Turnover Tax paid for ${p.month}${p.reference ? ` (${p.reference})` : ""}`,
    sourceType: "tot_payment",
    sourceId: Number(p.month.replace("-", "")),
    lines: [
      { accountId: await acct(tx, SYS.TOT_PAYABLE), debitCents: p.amountCents },
      { accountId: await acct(tx, MONEY_ACCOUNTS[p.paidFrom].code), creditCents: p.amountCents },
    ],
  });
}

/** Accountant's journal. Stock and system-managed accounts are off limits so FIFO and sub-ledgers stay true. */
const PROTECTED = new Set<string>([SYS.INVENTORY, SYS.CASH_DRAWER, SYS.AR, SYS.AP, SYS.LOYALTY_LIABILITY, SYS.EXCHANGE_CREDIT]);

export async function manualJournal(tx: Tx, p: { date: string; memo: string; lines: { accountId: number; debitCents: number; creditCents: number }[] }): Promise<number> {
  const { orgId, role } = ctx();
  if (role !== "owner" && role !== "accountant") throw new MoneyError("Only the owner or accountant can post journals.");
  if (!p.memo.trim()) throw new MoneyError("Explain what the journal is for.");
  if (p.lines.length < 2) throw new MoneyError("A journal needs at least two lines.");
  for (const l of p.lines) {
    const [a] = await tx.select().from(accounts).where(and(eq(accounts.orgId, orgId), eq(accounts.id, l.accountId))).limit(1);
    if (!a) throw new MoneyError("Unknown account.");
    if (PROTECTED.has(a.code)) throw new MoneyError(`${a.name} is kept by the system (sales, stock, customers, suppliers). Use the matching screen instead.`);
    if (l.debitCents && l.creditCents) throw new MoneyError("Each line is either a debit or a credit.");
  }
  return postEntry(tx, { date: p.date, memo: p.memo.trim(), sourceType: "manual", lines: p.lines.map((l) => ({ accountId: l.accountId, debitCents: l.debitCents, creditCents: l.creditCents })) });
}
