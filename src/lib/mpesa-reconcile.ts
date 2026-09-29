import { and, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { customerPayments, mpesaImports, mpesaStatementLines, salePayments, sales, type DbOrTx, type Tx } from "@/db";
import { ctx } from "./context";
import type { StatementLine } from "./mpesa-statement";

/**
 * Matches the M-Pesa statement against the codes cashiers typed at the till.
 * - matched: the code was used on a sale / payment on account and the amounts agree
 * - amount_mismatch: code found but the amount differs
 * - not_in_pos: money came in but nobody recorded it (a sale rung up wrongly, or a personal transfer)
 * - withdrawal: money out of the till account (not matched)
 * Codes recorded at the till but missing from the statement are found by `missingFromStatement`.
 */
export async function importStatement(tx: Tx, fileName: string, lines: StatementLine[]) {
  const { orgId, memberId } = ctx();
  const dates = lines.map((l) => l.completedAt.slice(0, 10)).sort();
  const [imp] = await tx
    .insert(mpesaImports)
    .values({ orgId, fileName, rowCount: lines.length, fromDate: dates[0], toDate: dates.at(-1), memberId })
    .returning({ id: mpesaImports.id });

  const codes = lines.map((l) => l.code);
  const [pos, onAccount, already] = await Promise.all([
    tx.select({ code: salePayments.mpesaCode, amount: salePayments.amountCents, saleId: salePayments.saleId }).from(salePayments).where(and(eq(salePayments.orgId, orgId), inArray(salePayments.mpesaCode, codes))),
    tx.select({ code: customerPayments.mpesaCode, amount: customerPayments.amountCents, id: customerPayments.id }).from(customerPayments).where(and(eq(customerPayments.orgId, orgId), inArray(customerPayments.mpesaCode, codes))),
    tx.select({ code: mpesaStatementLines.code }).from(mpesaStatementLines).where(and(eq(mpesaStatementLines.orgId, orgId), inArray(mpesaStatementLines.code, codes))),
  ]);
  const seen = new Set(already.map((a) => a.code));
  const counts = { matched: 0, amount_mismatch: 0, not_in_pos: 0, withdrawal: 0, skipped: 0 };
  for (const l of lines) {
    if (seen.has(l.code)) { counts.skipped++; continue; }
    seen.add(l.code);
    const sale = pos.find((p) => p.code === l.code);
    const pay = onAccount.find((p) => p.code === l.code);
    const posAmount = sale?.amount ?? pay?.amount ?? null;
    const status = l.paidInCents === 0 && l.withdrawnCents > 0 ? "withdrawal" : posAmount === null ? "not_in_pos" : posAmount === l.paidInCents ? "matched" : "amount_mismatch";
    counts[status]++;
    await tx.insert(mpesaStatementLines).values({
      orgId, importId: imp.id, code: l.code, completedAt: l.completedAt, details: l.details, paidInCents: l.paidInCents, withdrawnCents: l.withdrawnCents,
      status, saleId: sale?.saleId ?? null, customerPaymentId: pay?.id ?? null, posAmountCents: posAmount,
    });
  }
  return { importId: imp.id, ...counts };
}

/** M-Pesa codes typed at the till between two dates that no imported statement contains. */
export async function missingFromStatement(db: DbOrTx, from: string, to: string) {
  const { orgId } = ctx();
  return db
    .select({ code: salePayments.mpesaCode, amountCents: salePayments.amountCents, receiptNo: sales.receiptNo, date: sales.businessDate, memberId: sales.memberId })
    .from(salePayments)
    .innerJoin(sales, eq(sales.id, salePayments.saleId))
    .where(
      and(
        eq(salePayments.orgId, orgId),
        isNotNull(salePayments.mpesaCode),
        gte(sales.businessDate, from),
        lte(sales.businessDate, to),
        sql`not exists (select 1 from mpesa_statement_lines m where m.org_id = ${orgId} and m.code = "sale_payments"."mpesa_code")`
      )
    );
}
