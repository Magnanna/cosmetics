import "server-only";
import { eq } from "drizzle-orm";
import { db, customers, orgs, sales, smsLog, smsSettings } from "@/db";
import { decryptJson } from "./secrets";
import { fmtPoints } from "./loyalty";

/**
 * SMS via Advanta (quicksms.advantasms.com), configured per shop in
 * Settings → SMS messages (API key, partner ID, sender ID — encrypted at rest).
 * Without a working setup, messages are logged as "skipped" and nothing is sent.
 */

export type SmsCategory = "receipt" | "credit" | "points" | "owner" | "marketing" | "supplier";

const ADVANTA_URL = "https://quicksms.advantasms.com/api/services/sendsms/";

export interface AdvantaConfig {
  apiKey: string;
  partnerId: string;
  senderId: string;
}

export async function orgSmsConfig(orgId: number): Promise<AdvantaConfig | null> {
  const [row] = await db.select().from(smsSettings).where(eq(smsSettings.orgId, orgId)).limit(1);
  if (!row?.enabled) return null;
  const c = decryptJson<Partial<AdvantaConfig>>(row.configEnc);
  return c?.apiKey && c.partnerId && c.senderId ? { apiKey: c.apiKey, partnerId: c.partnerId, senderId: c.senderId } : null;
}

export async function smsConfigured(orgId: number): Promise<boolean> {
  return (await orgSmsConfig(orgId)) !== null;
}

/** One message through Advanta. `phone` is 2547XXXXXXXX. */
export async function sendViaAdvanta(cfg: AdvantaConfig, phone: string, message: string): Promise<{ ok: true; ref: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(ADVANTA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apikey: cfg.apiKey, partnerID: cfg.partnerId, shortcode: cfg.senderId, mobile: phone, message }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let data: { responses?: Record<string, unknown>[] } & Record<string, unknown> = {};
    try { data = JSON.parse(text); } catch { /* non-JSON error body */ }
    // Advanta: { responses: [{ "response-code": 200, "messageid": ..., "mobile": ... }] }
    const first = data.responses?.[0];
    const code = first?.["response-code"] ?? data["response-code"];
    if (res.ok && Number(code) === 200) return { ok: true, ref: String(first?.messageid ?? "") };
    return { ok: false, error: `Advanta ${res.status}: ${String(first?.["response-description"] ?? text.slice(0, 160))}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "Advanta request failed" };
  }
}

export async function sendSms(p: { orgId: number; to: string; body: string; category: SmsCategory; customerId?: number | null }): Promise<"sent" | "failed" | "skipped"> {
  const phone = p.to.replace(/\D/g, "").replace(/^0/, "254");
  const log = (status: "sent" | "failed" | "skipped", extra: { providerId?: string; error?: string } = {}) =>
    db.insert(smsLog).values({ orgId: p.orgId, customerId: p.customerId ?? null, to: `+${phone}`, category: p.category, body: p.body, status, ...extra });
  const cfg = await orgSmsConfig(p.orgId);
  if (!cfg) {
    await log("skipped", { error: "SMS not set up" });
    return "skipped";
  }
  const r = await sendViaAdvanta(cfg, phone, p.body);
  if (r.ok) {
    await log("sent", { providerId: r.ref });
    return "sent";
  }
  await log("failed", { error: r.error });
  return "failed";
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
