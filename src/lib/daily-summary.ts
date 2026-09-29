import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, orgs, salePayments, sales, shifts } from "@/db";
import { sendSms } from "./sms";

const k = (c: number) => Math.round(c / 100).toLocaleString("en-KE");

/**
 * The owner's end-of-day SMS: sales, margin, M-Pesa, credit given, till
 * difference, and how many products are running low.
 */
export async function sendDailySummaries(date: string): Promise<{ sent: number; skipped: number }> {
  let sent = 0;
  let skipped = 0;
  for (const org of await db.select().from(orgs)) {
    if (!org.phone) { skipped++; continue; }
    const [t] = await db
      .select({ n: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(${sales.totalCents}),0)`, cost: sql<string>`coalesce(sum(${sales.costCents}),0)` })
      .from(sales)
      .where(and(eq(sales.orgId, org.id), eq(sales.businessDate, date)));
    const tenders = await db
      .select({ method: salePayments.method, total: sql<string>`sum(${salePayments.amountCents})` })
      .from(salePayments)
      .innerJoin(sales, eq(sales.id, salePayments.saleId))
      .where(and(eq(sales.orgId, org.id), eq(sales.businessDate, date)))
      .groupBy(salePayments.method);
    const [v] = await db
      .select({ v: sql<string>`coalesce(sum(${shifts.varianceCents}),0)`, open: sql<number>`count(*) filter (where ${shifts.status} = 'open')::int` })
      .from(shifts)
      .where(and(eq(shifts.orgId, org.id), sql`(${shifts.closedAt} at time zone 'Africa/Nairobi')::date = ${date}::date or (${shifts.status} = 'open' and ${shifts.orgId} = ${org.id})`));
    const [low] = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from (
        select v.id from variants v left join stock_lots l on l.variant_id = v.id
        where v.org_id = ${org.id} and not v.archived and v.reorder_level > 0
        group by v.id having coalesce(sum(l.remaining_qty),0) <= v.reorder_level) x`);
    const total = Number(t.total);
    const tender = (m: string) => Number(tenders.find((x) => x.method === m)?.total ?? 0);
    const margin = total > 0 ? Math.round(((total - Number(t.cost)) / total) * 100) : 0;
    const variance = Number(v.v);
    const parts = [
      `${org.name} ${date}: sales KES ${k(total)} (${t.n} receipts${total ? `, margin ${margin}%` : ""}).`,
      `Cash ${k(tender("cash"))}, M-Pesa ${k(tender("mpesa"))}${tender("credit") ? `, on account ${k(tender("credit"))}` : ""}.`,
      variance ? `Till ${variance < 0 ? "SHORT" : "over"} KES ${k(Math.abs(variance))}.` : "",
      Number(v.open) ? "Till not closed yet." : "",
      Number(low.n) ? `${low.n} products running low.` : "",
    ].filter(Boolean);
    const r = await sendSms({ orgId: org.id, to: org.phone, body: parts.join(" "), category: "owner" });
    if (r === "sent") sent++;
    else skipped++;
  }
  return { sent, skipped };
}
