"use server";

import { and, eq } from "drizzle-orm";
import { db, suppliers } from "@/db";
import { audit, withSession } from "@/lib/auth";
import { normalizeKenyanPhone } from "@/lib/phone";
import { sendSms } from "@/lib/sms";

/** Texts the order to the supplier through the shop's Advanta account. */
export async function textSupplierOrder(supplierId: number, message: string, lineCount: number): Promise<{ ok?: string; error?: string }> {
  return withSession("stock.receive", async (s) => {
    const [sup] = await db.select().from(suppliers).where(and(eq(suppliers.orgId, s.org.id), eq(suppliers.id, supplierId))).limit(1);
    if (!sup) return { error: "Supplier not found." };
    const phone = sup.phone ? normalizeKenyanPhone(sup.phone) : null;
    if (!phone) return { error: `Add a mobile number for ${sup.name} on the Suppliers page first.` };
    if (message.length > 1500) return { error: "That order is too long for SMS — use WhatsApp or split it." };
    const r = await sendSms({ orgId: s.org.id, to: phone, body: message, category: "supplier" });
    await audit(db, { action: "reorder.sent", entity: "supplier", entityId: sup.id, after: { lines: lineCount, sms: r } });
    if (r === "sent") return { ok: `Order texted to ${sup.name}.` };
    if (r === "skipped") return { error: "SMS isn't switched on — set up Advanta in Settings → SMS messages, or use WhatsApp." };
    return { error: "The SMS didn't go through — see Settings → SMS messages for the reason." };
  });
}
