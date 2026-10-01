"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, smsSettings } from "@/db";
import { audit, ForbiddenError, withSession } from "@/lib/auth";
import { normalizeKenyanPhone } from "@/lib/phone";
import { decryptJson, encryptJson } from "@/lib/secrets";
import { orgSmsConfig, sendViaAdvanta, type AdvantaConfig } from "@/lib/sms";

type State = { ok?: string; error?: string };

/** Saves the shop's Advanta keys. Blank secret fields keep what's saved. */
export async function saveSmsSettings(form: FormData): Promise<State> {
  try {
    return await withSession("settings.edit", async (s) => {
      const enabled = form.get("enabled") === "on";
      const input = { apiKey: String(form.get("apiKey") ?? "").trim(), partnerId: String(form.get("partnerId") ?? "").trim(), senderId: String(form.get("senderId") ?? "").trim() };
      if (input.senderId.length > 11) return { error: "A sender ID is at most 11 characters (e.g. KENFRI)." };
      const [existing] = await db.select().from(smsSettings).where(eq(smsSettings.orgId, s.org.id)).limit(1);
      const old = decryptJson<Partial<AdvantaConfig>>(existing?.configEnc ?? null) ?? {};
      const cfg = { apiKey: input.apiKey || old.apiKey || "", partnerId: input.partnerId || old.partnerId || "", senderId: input.senderId || old.senderId || "" };
      if (enabled && (!cfg.apiKey || !cfg.partnerId || !cfg.senderId)) return { error: "To switch SMS on, fill in the API key, partner ID and sender ID from your Advanta portal." };
      const values = { enabled, senderId: cfg.senderId || null, configEnc: encryptJson(cfg), updatedAt: new Date() };
      if (existing) await db.update(smsSettings).set(values).where(eq(smsSettings.id, existing.id));
      else await db.insert(smsSettings).values({ orgId: s.org.id, provider: "advanta", ...values });
      await audit(db, { action: "settings.sms", entity: "org", entityId: s.org.id, after: { enabled, senderId: cfg.senderId, keysChanged: !!(input.apiKey || input.partnerId) } });
      revalidatePath("/settings/messages");
      return { ok: enabled ? "Saved. SMS is on." : "Saved. SMS is off — messages are recorded but not sent." };
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    return { error: (e as Error).message };
  }
}

export async function sendTestSms(phone: string): Promise<State> {
  return withSession("settings.edit", async (s) => {
    const to = normalizeKenyanPhone(phone);
    if (!to) return { error: "Enter a Kenyan mobile, e.g. 0712 345 678." };
    const cfg = await orgSmsConfig(s.org.id);
    if (!cfg) return { error: "Save your Advanta details with SMS switched on first." };
    const r = await sendViaAdvanta(cfg, to, `Test message from ${s.org.name}: SMS receipts are working.`);
    return r.ok ? { ok: "Test SMS sent — check the phone." } : { error: r.error };
  });
}
