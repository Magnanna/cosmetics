import { and, eq, inArray, sql } from "drizzle-orm";
import { accounts, cashMovements, customerPayments, journalLines, saleReturns, salePayments, sales, shifts, type DbOrTx, type Tx } from "@/db";
import { SYS } from "./coa";
import { ctx } from "./context";
import { acct, postEntry, signedPair } from "./ledger";

/**
 * Cash in the drawer. Every cash movement at the till posts through the Cash
 * Drawer account, and closing a shift empties it into Cash at Hand — so the
 * cash expected in the drawer is simply that account's balance.
 * (One till per shop in v1; more tills would each need their own drawer account.)
 */

export class CashError extends Error {}

export const CASH_OUT_REASONS = {
  petty_expense: "Paid an expense",
  owner_drawing: "Owner took cash",
  to_bank: "Taken to the bank",
} as const;
export const CASH_IN_REASONS = { float_topup: "Added change / float" } as const;
export type CashReason = keyof typeof CASH_OUT_REASONS | keyof typeof CASH_IN_REASONS;

async function openShift(tx: DbOrTx, shiftId: number) {
  const [s] = await tx.select().from(shifts).where(and(eq(shifts.orgId, ctx().orgId), eq(shifts.id, shiftId))).limit(1);
  if (!s) throw new CashError("Shift not found.");
  if (s.status !== "open") throw new CashError("This shift is already closed.");
  return s;
}

/** Cash put into or taken out of the drawer mid-shift, with a reason. */
export async function recordCashMovement(
  tx: Tx,
  p: { shiftId: number; reason: CashReason; amountCents: number; note?: string | null; expenseAccountCode?: string; date: string }
): Promise<number> {
  const { orgId, memberId } = ctx();
  await openShift(tx, p.shiftId);
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) throw new CashError("Enter an amount above zero.");
  const direction = p.reason in CASH_IN_REASONS ? "in" : "out";
  if (p.reason === "petty_expense" && !p.note?.trim()) throw new CashError("Say what the expense was for.");

  const drawer = await acct(tx, SYS.CASH_DRAWER);
  let other: number;
  if (p.reason === "float_topup") other = await acct(tx, SYS.CASH_AT_HAND);
  else if (p.reason === "owner_drawing") other = await acct(tx, SYS.DRAWINGS);
  else if (p.reason === "to_bank") other = await acct(tx, SYS.BANK);
  else {
    const code = p.expenseAccountCode ?? SYS.OTHER_EXPENSE;
    const [a] = await tx.select({ id: accounts.id, type: accounts.type }).from(accounts).where(and(eq(accounts.orgId, orgId), eq(accounts.code, code))).limit(1);
    if (!a || a.type !== "expense") throw new CashError("Pick an expense category.");
    other = a.id;
  }

  const [row] = await tx
    .insert(cashMovements)
    .values({ orgId, shiftId: p.shiftId, direction, reason: p.reason, amountCents: p.amountCents, note: p.note?.trim() || null, memberId })
    .returning({ id: cashMovements.id });
  const label = (CASH_OUT_REASONS as Record<string, string>)[p.reason] ?? (CASH_IN_REASONS as Record<string, string>)[p.reason];
  const entryId = await postEntry(tx, {
    date: p.date,
    memo: `${label}${p.note ? `: ${p.note}` : ""}`,
    sourceType: "cash_movement",
    sourceId: row.id,
    lines: direction === "in"
      ? [{ accountId: drawer, debitCents: p.amountCents }, { accountId: other, creditCents: p.amountCents }]
      : [{ accountId: other, debitCents: p.amountCents }, { accountId: drawer, creditCents: p.amountCents }],
  });
  await tx.update(cashMovements).set({ journalEntryId: entryId }).where(eq(cashMovements.id, row.id));
  return row.id;
}

export async function drawerBalanceCents(db: DbOrTx): Promise<number> {
  const { orgId } = ctx();
  const [r] = await db
    .select({ b: sql<string>`coalesce(sum(${journalLines.debitCents} - ${journalLines.creditCents}), 0)` })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalLines.orgId, orgId), eq(accounts.code, SYS.CASH_DRAWER)));
  return Number(r.b);
}

export interface ShiftSummary {
  shiftId: number;
  openedAt: string;
  openingFloatCents: number;
  saleCount: number;
  salesCents: number;
  byTender: Record<string, number>;
  changeGivenCents: number;
  discountsCents: number;
  refunds: { count: number; byMethod: Record<string, number>; exchangesCents: number };
  creditPaymentsCents: Record<string, number>;
  cashIn: number;
  cashOut: number;
  movements: { reason: string; amountCents: number; note: string | null }[];
  expectedCashCents: number;
}

/** X-report: everything that happened on this shift so far. */
export async function shiftSummary(db: DbOrTx, shiftId: number): Promise<ShiftSummary> {
  const { orgId } = ctx();
  const [shift] = await db.select().from(shifts).where(and(eq(shifts.orgId, orgId), eq(shifts.id, shiftId))).limit(1);
  if (!shift) throw new CashError("Shift not found.");
  const saleRows = await db.select({ id: sales.id, total: sales.totalCents, disc: sql<number>`${sales.manualDiscountCents} + ${sales.promoDiscountCents}` }).from(sales).where(eq(sales.shiftId, shiftId));
  const pays = saleRows.length
    ? await db.select({ method: salePayments.method, amount: salePayments.amountCents, change: salePayments.changeCents }).from(salePayments).where(inArray(salePayments.saleId, saleRows.map((s) => s.id)))
    : [];
  const byTender: Record<string, number> = {};
  for (const p of pays) byTender[p.method] = (byTender[p.method] ?? 0) + p.amount;
  const rets = await db.select().from(saleReturns).where(eq(saleReturns.shiftId, shiftId));
  const byMethod: Record<string, number> = {};
  for (const r of rets.filter((r) => r.kind === "refund")) byMethod[r.refundMethod!] = (byMethod[r.refundMethod!] ?? 0) + r.totalCents;
  const cps = await db.select({ method: customerPayments.method, amount: customerPayments.amountCents }).from(customerPayments).where(eq(customerPayments.shiftId, shiftId));
  const creditPaymentsCents: Record<string, number> = {};
  for (const c of cps) creditPaymentsCents[c.method] = (creditPaymentsCents[c.method] ?? 0) + c.amount;
  const moves = await db.select().from(cashMovements).where(eq(cashMovements.shiftId, shiftId));

  return {
    shiftId,
    openedAt: shift.openedAt.toISOString(),
    openingFloatCents: shift.openingFloatCents,
    saleCount: saleRows.length,
    salesCents: saleRows.reduce((s, r) => s + r.total, 0),
    byTender,
    changeGivenCents: pays.reduce((s, p) => s + (p.change ?? 0), 0),
    discountsCents: saleRows.reduce((s, r) => s + Number(r.disc), 0),
    refunds: { count: rets.length, byMethod, exchangesCents: rets.filter((r) => r.kind === "exchange").reduce((s, r) => s + r.totalCents, 0) },
    creditPaymentsCents,
    cashIn: moves.filter((m) => m.direction === "in").reduce((s, m) => s + m.amountCents, 0),
    cashOut: moves.filter((m) => m.direction === "out").reduce((s, m) => s + m.amountCents, 0),
    movements: moves.map((m) => ({ reason: m.reason, amountCents: m.direction === "in" ? m.amountCents : -m.amountCents, note: m.note })),
    expectedCashCents: await drawerBalanceCents(db),
  };
}

export const DENOMINATIONS = [100_000, 50_000, 20_000, 10_000, 5_000, 4_000, 2_000, 1_000, 500, 100] as const;

/**
 * Z-report: blind count → variance posted to Cash Over/Short → the counted
 * cash moves from the drawer to Cash at Hand (next shift's float comes back
 * from there). Returns the variance (+ over, − short).
 */
export async function closeShift(
  tx: Tx,
  p: { shiftId: number; counts: Partial<Record<(typeof DENOMINATIONS)[number], number>>; date: string }
): Promise<{ countedCents: number; expectedCents: number; varianceCents: number }> {
  const { memberId } = ctx();
  const shift = await openShift(tx, p.shiftId);
  await tx.select({ id: shifts.id }).from(shifts).where(eq(shifts.id, shift.id)).for("update");

  let counted = 0;
  for (const d of DENOMINATIONS) {
    const n = p.counts[d] ?? 0;
    if (!Number.isInteger(n) || n < 0) throw new CashError("Counts must be whole numbers.");
    counted += n * d;
  }
  const summary = await shiftSummary(tx, shift.id);
  const expected = summary.expectedCashCents;
  const variance = counted - expected;

  const drawer = await acct(tx, SYS.CASH_DRAWER);
  const lines = [
    ...signedPair(variance, drawer, await acct(tx, SYS.CASH_OVER_SHORT), variance >= 0 ? "Drawer over" : "Drawer short"),
    ...signedPair(counted, await acct(tx, SYS.CASH_AT_HAND), drawer, "Cash taken from the drawer at close"),
  ];
  if (lines.length) await postEntry(tx, { date: p.date, memo: `Close shift #${shift.id}`, sourceType: "shift_close", sourceId: shift.id, lines });

  await tx
    .update(shifts)
    .set({
      status: "closed",
      closedBy: memberId,
      closedAt: new Date(),
      countedCashCents: counted,
      expectedCashCents: expected,
      varianceCents: variance,
      zReport: { ...summary, counts: p.counts, countedCents: counted, varianceCents: variance },
    })
    .where(eq(shifts.id, shift.id));
  return { countedCents: counted, expectedCents: expected, varianceCents: variance };
}
