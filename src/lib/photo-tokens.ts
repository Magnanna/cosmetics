import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, photoTokens, products } from "@/db";

/** A valid, unused, unexpired phone-photo link, with the product it's for. */
export async function openPhotoToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  const [row] = await db
    .select({ t: photoTokens, productName: products.name })
    .from(photoTokens)
    .innerJoin(products, eq(products.id, photoTokens.productId))
    .where(and(eq(photoTokens.token, token), isNull(photoTokens.usedAt), gt(photoTokens.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
}
