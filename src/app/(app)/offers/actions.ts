"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, offerTargets, offers, products, variants } from "@/db";
import { ImageError, saveGeneratedImage } from "@/lib/images";
import { generateImage, MagnificError, magnificEnabled } from "@/lib/magnific";
import { backdropPrompt, offerHeadline, offerPrice } from "@/lib/poster";
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

export interface PosterData {
  offerId: number;
  title: string;
  description: string | null;
  headline: string;
  endsAt: string;
  shopName: string;
  shopPhone: string | null;
  logoUrl: string | null;
  brandColor: string;
  backdropUrl: string | null;
  products: { name: string; imageUrl: string; cutout: boolean; priceCents: number; offerPriceCents: number | null }[];
}

type PosterResult = { ok: true; data: PosterData } | { ok: false; error: string };

/**
 * Everything the poster maker draws. The backdrop is made once per format with
 * Magnific (no text in it) and reused; `fresh` asks for a new one.
 */
export async function posterData(offerId: number, format: "square" | "story", fresh = false): Promise<PosterResult> {
  try {
    return await withSession("catalog.edit", async (s) => {
      const [o] = await db.select().from(offers).where(and(eq(offers.orgId, s.org.id), eq(offers.id, offerId))).limit(1);
      if (!o) return { ok: false, error: "Offer not found." };
      const targets = await db.select().from(offerTargets).where(eq(offerTargets.offerId, o.id));
      const ids = (k: string) => targets.filter((t) => t.kind === k).map((t) => t.targetId);
      const conds = [];
      if (ids("product").length) conds.push(inArray(products.id, ids("product")));
      if (ids("variant").length) conds.push(inArray(products.id, db.select({ id: variants.productId }).from(variants).where(inArray(variants.id, ids("variant")))));
      if (ids("brand").length) conds.push(inArray(products.brandId, ids("brand")));
      if (ids("category").length) conds.push(inArray(products.categoryId, ids("category")));
      const rows = await db
        .select({ id: products.id, name: products.name, imageUrl: products.imageUrl, cutoutUrl: products.imageCutoutUrl, price: sql<number>`(select min(${variants.retailPriceCents}) from ${variants} where ${variants.productId} = ${products.id} and not ${variants.archived})` })
        .from(products)
        .where(and(eq(products.orgId, s.org.id), eq(products.archived, false), isNotNull(products.imageUrl), ...(conds.length ? [or(...conds)] : [])))
        .orderBy(sql`${products.imageCutoutUrl} is null`, desc(products.updatedAt))
        .limit(3);

      let backdropUrl = o.posterBackdrops?.[format] ?? null;
      if ((fresh || !backdropUrl) && magnificEnabled()) {
        const bytes = await generateImage(backdropPrompt(s.org.brandColor), format === "square" ? "square_1_1" : "social_story_9_16");
        const jpg = await (await import("sharp")).default(bytes).jpeg({ quality: 88 }).toBuffer();
        backdropUrl = await saveGeneratedImage(s.org.id, `poster-${o.id}-${format}`, jpg, "image/jpeg");
        await db.update(offers).set({ posterBackdrops: { ...(o.posterBackdrops ?? {}), [format]: backdropUrl } }).where(eq(offers.id, o.id));
      }
      return {
        ok: true,
        data: {
          offerId: o.id, title: o.title, description: o.description, headline: offerHeadline(o.type, o.value), endsAt: o.endsAt.toISOString(),
          shopName: s.org.name, shopPhone: s.org.phone, logoUrl: s.org.logoUrl, brandColor: s.org.brandColor, backdropUrl,
          products: rows.map((r) => ({ name: r.name, imageUrl: (r.cutoutUrl ?? r.imageUrl)!, cutout: !!r.cutoutUrl, priceCents: Number(r.price ?? 0), offerPriceCents: r.price ? offerPrice(o.type, o.value, Number(r.price)) : null })),
        },
      };
    });
  } catch (e) {
    if (e instanceof MagnificError || e instanceof ImageError || e instanceof ForbiddenError) return { ok: false, error: e.message };
    throw e;
  }
}
