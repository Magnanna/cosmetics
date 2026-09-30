import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, customers, orgs, smsLog } from "@/db";
import { runWithOrg } from "./context";
import { customerStatement } from "./credit";
import { sendSms } from "./sms";

import { oldestUnpaid, reminderStage, reminderText } from "./credit-reminder-rules";

export async function sendCreditReminders(today: string): Promise<{ sent: number; skipped: number }> {
  let sent = 0;
  let skipped = 0;
  for (const org of await db.select().from(orgs)) {
    const credit = await db.select().from(customers).where(and(eq(customers.orgId, org.id), eq(customers.creditEnabled, true)));
    for (const c of credit) {
      const st = await runWithOrg({ orgId: org.id, memberId: null, role: "owner" }, () => customerStatement(db, c.id, "1900-01-01", today));
      const unpaid = oldestUnpaid(st.lines, 0);
      if (!unpaid) continue;
      const due = new Date(Date.parse(unpaid.date) + c.creditTermsDays * 86_400_000).toISOString().slice(0, 10);
      const stage = reminderStage(due, today);
      if (!stage) continue;
      // Never more than one reminder a day per customer.
      const [already] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(smsLog)
        .where(and(eq(smsLog.orgId, org.id), eq(smsLog.customerId, c.id), eq(smsLog.category, "credit"), gte(smsLog.createdAt, new Date(`${today}T00:00:00+03:00`))));
      if (already.n > 0) { skipped++; continue; }
      const r = await sendSms({ orgId: org.id, to: c.phone, category: "credit", customerId: c.id, body: reminderText({ shop: org.name, name: c.businessName || c.name, owedCents: unpaid.owedCents, dueDate: due, ...stage }) });
      if (r === "sent") sent++;
      else skipped++;
    }
  }
  return { sent, skipped };
}
