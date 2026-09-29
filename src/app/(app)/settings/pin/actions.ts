"use server";

import { eq } from "drizzle-orm";
import { db, members } from "@/db";
import { audit, withSession } from "@/lib/auth";
import { hashPin, PinError } from "@/lib/pin";

export async function setMyPin(_: unknown, form: FormData): Promise<{ error?: string; ok?: boolean }> {
  const pin = String(form.get("pin") ?? "");
  if (pin !== String(form.get("confirm") ?? "")) return { error: "The two PINs don't match." };
  try {
    await withSession(null, async (s) => {
      const hash = await hashPin(pin);
      await db.transaction(async (tx) => {
        await tx.update(members).set({ pinHash: hash }).where(eq(members.id, s.member.id));
        await audit(tx, { action: "member.set_pin", entity: "member", entityId: s.member.id });
      });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof PinError) return { error: e.message };
    throw e;
  }
}
