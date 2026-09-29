import "server-only";
import { eq } from "drizzle-orm";
import { db, customers, orgs, sales, smsLog } from "@/db";
import { fmtPoints } from "./loyalty";

/**
 * SMS via Africa's Talking (POST /version1/messaging/bulk, JSON, apiKey header).
 * Configure in .env.local: AT_USERNAME, AT_API_KEY, optional AT_SENDER_ID
 * (e.g. KENFRI, once registered) and AT_SANDBOX=true for testing.
 * Without credentials, messages are logged as "skipped" and nothing is sent.
 */

export type SmsCategory = "receipt" | "credit" | "points" | "owner" | "marketing";

export function smsConfigured(): boolean {
  return !!(process.env.AT_USERNAME && process.env.AT_API_KEY);
}

export async function sendSms(p: { orgId: number; to: string; body: string; category: SmsCategory; customerId?: number | null }): Promise<"sent" | "failed" | "skipped"> {
  const to = p.to.startsWith("+") ? p.to : `+${p.to}`;
  const log = (status: "sent" | "failed" | "skipped", extra: { providerId?: string; costText?: string; error?: string } = {}) =>
    db.insert(smsLog).values({ orgId: p.orgId, customerId: p.customerId ?? null, to, category: p.category, body: p.body, status, ...extra });

  if (!smsConfigured()) {
    await log("skipped", { error: "SMS not configured" });
    return "skipped";
  }
  const host = process.env.AT_SANDBOX === "true" ? "https://api.sandbox.africastalking.com" : "https://api.africastalking.com";
  try {
    const res = await fetch(`${host}/version1/messaging/bulk`, {
      method: "POST",
      headers: { apiKey: process.env.AT_API_KEY!, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        username: process.env.AT_USERNAME,
        message: p.body,
        phoneNumbers: [to],
        ...(process.env.AT_SENDER_ID ? { senderId: process.env.AT_SENDER_ID } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => null)) as { SMSMessageData?: { Recipients?: { statusCode: number; status: string; cost: string; messageId: string }[]; Message?: string } } | null;
    const r = json?.SMSMessageData?.Recipients?.[0];
    if (res.ok && r && [100, 101, 102].includes(r.statusCode)) {
      await log("sent", { providerId: r.messageId, costText: r.cost });
      return "sent";
    }
    await log("failed", { error: r ? `${r.statusCode} ${r.status}` : `HTTP ${res.status} ${json?.SMSMessageData?.Message ?? ""}`.trim() });
    return "failed";
  } catch (e) {
    await log("failed", { error: (e as Error).message });
    return "failed";
  }
}

const kes = (c: number) => `KES ${(c / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "Kenfri Cosmetics: receipt KF-000123, KES 1,020.00. You earned 87.00 pts (balance 90.00). View: <link>" */
export async function sendSaleReceiptSms(saleId: number): Promise<void> {
  const [row] = await db
    .select({ sale: sales, customer: customers, org: orgs })
    .from(sales)
    .innerJoin(customers, eq(customers.id, sales.customerId))
    .innerJoin(orgs, eq(orgs.id, sales.orgId))
    .where(eq(sales.id, saleId))
    .limit(1);
  if (!row) return;
  const base = process.env.NEXT_PUBLIC_APP_URL;
  const earns = row.customer.earnsPointsOverride ?? row.customer.type === "retail";
  const parts = [`${row.org.name}: receipt ${row.sale.receiptNo}, ${kes(row.sale.totalCents)}.`];
  if (earns && row.sale.pointsEarned > 0) parts.push(`You earned ${fmtPoints(row.sale.pointsEarned)} pts (balance ${fmtPoints(row.customer.pointsBalance)}).`);
  if (base) parts.push(`View: ${base}/r/${row.sale.receiptToken}`);
  parts.push("Thank you!");
  await sendSms({ orgId: row.org.id, to: row.customer.phone, body: parts.join(" "), category: "receipt", customerId: row.customer.id });
}
