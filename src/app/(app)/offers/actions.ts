"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, offerTargets, offers } from "@/db";
import { audit, ForbiddenError, withSession } from "@/lib/auth";

const OfferInput = z.object({
  title: z.string().trim().min(3, "Give the offer a short name customers will see.").max(60),
  description: z.string().trim().max(200).nullable(),
  type: z.enum(["percent_off", "amount_off", "fixed_price", "bonus_points", "points_multiplier"]),
  value: z.number().int().min(1, "Enter the offer amount."),
  minSpendCents: z.number().int().min(0),
  audience: z.enum(["all", "retail", "wholesale"]),
  startsAt: z.string().min(10),
  endsAt: z.string().min(10),
  targetKind: z.enum(["all", "brand", "category", "product"]),
  targetIds: z.array(z.number().int()),
});

export async function createOffer(raw: z.infer<typeof OfferInput>): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = OfferInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const v = parsed.data;
  // datetime-local values are Nairobi time.
  const startsAt = new Date(`${v.startsAt}:00+03:00`);
  const endsAt = new Date(`${v.endsAt}:00+03:00`);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return { ok: false, error: "Pick a start and end." };
  if (endsAt <= startsAt) return { ok: false, error: "The offer must end after it starts." };
  if (v.type === "percent_off" && v.value > 9_000) return { ok: false, error: "Percent off can't be more than 90%." };
  if (v.type === "points_multiplier" && v.value < 150) return { ok: false, error: "A multiplier should be at least 1.5×." };
  if (v.targetKind !== "all" && v.targetIds.length === 0) return { ok: false, error: "Pick what the offer applies to." };
  if (v.type === "fixed_price" && v.targetKind !== "product") return { ok: false, error: "A fixed price applies to specific products." };
  try {
    await withSession("catalog.set_prices", (s) =>
      db.transaction(async (tx) => {
        const [o] = await tx
          .insert(offers)
          .values({ orgId: s.org.id, title: v.title, description: v.description, type: v.type, value: v.value, minSpendCents: v.minSpendCents, audience: v.audience, startsAt, endsAt, createdBy: s.member.id })
          .returning({ id: offers.id });
        if (v.targetKind !== "all") {
          await tx.insert(offerTargets).values(v.targetIds.map((id) => ({ orgId: s.org.id, offerId: o.id, kind: v.targetKind, targetId: id })));
        }
        await audit(tx, { action: "offer.create", entity: "offer", entityId: o.id, after: v });
      })
    );
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath("/offers");
  return { ok: true };
}

export async function setOfferActive(offerId: number, active: boolean) {
  await withSession("catalog.set_prices", (s) =>
    db.transaction(async (tx) => {
      await tx.update(offers).set({ active }).where(and(eq(offers.orgId, s.org.id), eq(offers.id, offerId)));
      await audit(tx, { action: active ? "offer.resume" : "offer.pause", entity: "offer", entityId: offerId });
    })
  );
  revalidatePath("/offers");
}
