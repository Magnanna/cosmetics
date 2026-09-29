import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { accounts, journalEntries, journalLines, orgs, type DbOrTx } from "@/db";
import { SYS } from "./coa";
import { ctx } from "./context";

/**
 * Financial reports. Every figure comes from the ledger (journal lines),
 * never from sale or bill tables, so the reports always agree with each other.
 */

export interface AccountBalance {
  accountId: number;
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "income" | "expense";
  subtype: string;
  debitCents: number;
  creditCents: number;
  /** Natural-side balance: debit-normal for assets/expenses, credit-normal otherwise. */
  balanceCents: number;
}

function natural(type: string, dr: number, cr: number) {
  return type === "asset" || type === "expense" ? dr - cr : cr - dr;
}

/** Account totals for entries dated within [from, to] (from = null → since the beginning). */
export async function balances(db: DbOrTx, from: string | null, to: string): Promise<AccountBalance[]> {
  const { orgId } = ctx();
  const conds = [eq(journalLines.orgId, orgId), lte(journalEntries.date, to)];
  if (from) conds.push(gte(journalEntries.date, from));
  const moved = await db
    .select({ accountId: journalLines.accountId, dr: sql<string>`sum(${journalLines.debitCents})`, cr: sql<string>`sum(${journalLines.creditCents})` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(...conds))
    .groupBy(journalLines.accountId);
  const byId = new Map(moved.map((m) => [m.accountId, m]));
  const accts = await db.select().from(accounts).where(eq(accounts.orgId, orgId)).orderBy(asc(accounts.code));
  return accts.map((a) => {
    const m = byId.get(a.id);
    const dr = Number(m?.dr ?? 0);
    const cr = Number(m?.cr ?? 0);
    return { accountId: a.id, code: a.code, name: a.name, type: a.type as AccountBalance["type"], subtype: a.subtype, debitCents: dr, creditCents: cr, balanceCents: natural(a.type, dr, cr) };
  });
}

export interface Section {
  label: string;
  lines: { accountId: number; code: string; name: string; cents: number }[];
  totalCents: number;
}

function section(label: string, rows: AccountBalance[], sign = 1): Section {
  const lines = rows.filter((r) => r.balanceCents !== 0).map((r) => ({ accountId: r.accountId, code: r.code, name: r.name, cents: sign * r.balanceCents }));
  return { label, lines, totalCents: lines.reduce((s, l) => s + l.cents, 0) };
}

export interface ProfitAndLoss {
  from: string;
  to: string;
  sales: Section;
  lessSales: Section; // returns and discounts (shown as negatives)
  netSalesCents: number;
  costOfSales: Section;
  grossProfitCents: number;
  grossMarginPct: number | null;
  expenses: Section;
  netProfitCents: number;
}

export async function profitAndLoss(db: DbOrTx, from: string, to: string): Promise<ProfitAndLoss> {
  const b = await balances(db, from, to);
  const sales = section("Sales", b.filter((r) => r.type === "income" && r.subtype !== "contra_sales"));
  // Contra-sales accounts are income accounts with a debit balance: show them as deductions.
  const lessSales = section("Less returns & discounts", b.filter((r) => r.subtype === "contra_sales"));
  const netSalesCents = sales.totalCents + lessSales.totalCents;
  const costOfSales = section("Cost of sales", b.filter((r) => r.type === "expense" && r.subtype === "cogs"));
  const grossProfitCents = netSalesCents - costOfSales.totalCents;
  const expenses = section("Running costs", b.filter((r) => r.type === "expense" && r.subtype !== "cogs"));
  return {
    from, to, sales, lessSales, netSalesCents, costOfSales, grossProfitCents,
    grossMarginPct: netSalesCents > 0 ? Math.round((grossProfitCents / netSalesCents) * 1000) / 10 : null,
    expenses,
    netProfitCents: grossProfitCents - expenses.totalCents,
  };
}

export interface BalanceSheet {
  asOf: string;
  assets: Section;
  liabilities: Section;
  equity: Section;
  profitToDateCents: number;
  totalEquityCents: number;
  balanced: boolean;
}

export async function balanceSheet(db: DbOrTx, asOf: string): Promise<BalanceSheet> {
  const b = await balances(db, null, asOf);
  const assets = section("What the shop owns", b.filter((r) => r.type === "asset"));
  const liabilities = section("What the shop owes", b.filter((r) => r.type === "liability"));
  const equity = section("Owner's stake", b.filter((r) => r.type === "equity"));
  const profitToDateCents =
    b.filter((r) => r.type === "income").reduce((s, r) => s + r.balanceCents, 0) - b.filter((r) => r.type === "expense").reduce((s, r) => s + r.balanceCents, 0);
  const totalEquityCents = equity.totalCents + profitToDateCents;
  return { asOf, assets, liabilities, equity, profitToDateCents, totalEquityCents, balanced: assets.totalCents === liabilities.totalCents + totalEquityCents };
}

export async function trialBalance(db: DbOrTx, asOf: string) {
  const b = (await balances(db, null, asOf)).filter((r) => r.debitCents !== 0 || r.creditCents !== 0);
  const rows = b.map((r) => {
    const net = r.debitCents - r.creditCents;
    return { ...r, debitBalance: net > 0 ? net : 0, creditBalance: net < 0 ? -net : 0 };
  });
  const dr = rows.reduce((s, r) => s + r.debitBalance, 0);
  const cr = rows.reduce((s, r) => s + r.creditBalance, 0);
  return { asOf, rows, debitCents: dr, creditCents: cr, balanced: dr === cr };
}

/** Every movement on one account with a running balance. */
export async function accountLedger(db: DbOrTx, accountId: number, from: string, to: string) {
  const { orgId } = ctx();
  const [acct] = await db.select().from(accounts).where(and(eq(accounts.orgId, orgId), eq(accounts.id, accountId))).limit(1);
  if (!acct) return null;
  const [open] = await db
    .select({ dr: sql<string>`coalesce(sum(${journalLines.debitCents}),0)`, cr: sql<string>`coalesce(sum(${journalLines.creditCents}),0)` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalLines.orgId, orgId), eq(journalLines.accountId, accountId), sql`${journalEntries.date} < ${from}`));
  const rows = await db
    .select({ entryId: journalEntries.id, date: journalEntries.date, memo: journalEntries.memo, sourceType: journalEntries.sourceType, lineMemo: journalLines.memo, dr: journalLines.debitCents, cr: journalLines.creditCents })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalLines.orgId, orgId), eq(journalLines.accountId, accountId), gte(journalEntries.date, from), lte(journalEntries.date, to)))
    .orderBy(asc(journalEntries.date), asc(journalEntries.id), asc(journalLines.id));
  let bal = natural(acct.type, Number(open.dr), Number(open.cr));
  const opening = bal;
  const lines = rows.map((r) => {
    bal += natural(acct.type, r.dr, r.cr);
    return { ...r, balanceCents: bal };
  });
  return { account: acct, openingCents: opening, lines, closingCents: bal };
}

/* ---------------- Turnover Tax ---------------- */

export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export interface TotMonth {
  month: string;
  turnoverCents: number;
  rateBp: number;
  taxCents: number;
  postedEntryId: number | null;
  postedCents: number;
  paidCents: number;
  dueDate: string;
}

/**
 * Turnover for Turnover Tax = sales after returns and discounts (what
 * customers actually paid for goods). Rate from settings (default 1.5%).
 * Due by the 20th of the next month. Confirm the basis with the accountant.
 */
export async function totForMonth(db: DbOrTx, month: string): Promise<TotMonth> {
  const { orgId } = ctx();
  const { from, to } = monthRange(month);
  const pnl = await profitAndLoss(db, from, to);
  const [org] = await db.select({ rate: orgs.totRateBp }).from(orgs).where(eq(orgs.id, orgId));
  const turnover = Math.max(0, pnl.netSalesCents);
  const monthKey = Number(month.replace("-", ""));
  const [posted] = await db
    .select({ id: journalEntries.id, cents: sql<string>`(select sum(jl.debit_cents) from journal_lines jl where jl.entry_id = "journal_entries"."id")` })
    .from(journalEntries)
    .where(and(eq(journalEntries.orgId, orgId), eq(journalEntries.sourceType, "tot_accrual"), eq(journalEntries.sourceId, monthKey)))
    .limit(1);
  const [paid] = await db
    .select({ cents: sql<string>`coalesce(sum(jl.debit_cents),0)` })
    .from(journalEntries)
    .innerJoin(sql`journal_lines jl`, sql`jl.entry_id = ${journalEntries.id}`)
    .innerJoin(accounts, sql`${accounts.id} = jl.account_id`)
    .where(and(eq(journalEntries.orgId, orgId), eq(journalEntries.sourceType, "tot_payment"), eq(journalEntries.sourceId, monthKey), eq(accounts.code, SYS.TOT_PAYABLE)));
  const [y, m] = month.split("-").map(Number);
  const due = new Date(Date.UTC(y, m, 20)).toISOString().slice(0, 10);
  return {
    month,
    turnoverCents: turnover,
    rateBp: org.rate,
    taxCents: Math.round((turnover * org.rate) / 10_000),
    postedEntryId: posted?.id ?? null,
    postedCents: Number(posted?.cents ?? 0),
    paidCents: Number(paid?.cents ?? 0),
    dueDate: due,
  };
}
