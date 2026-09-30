import "server-only";
import { and, eq } from "drizzle-orm";
import { db, orgs, products } from "@/db";
import { saveGeneratedImage } from "./images";
import { removeBackground } from "./magnific";
import { studioShot } from "./studio";

export class StudioError extends Error {}

/** Cuts the product out with Magnific and puts it on the studio backdrop. Keeps the original. */
export async function makeStudioPhoto(orgId: number, productId: number): Promise<string> {
  const [row] = await db.select({ p: products, brand: orgs.brandColor }).from(products).innerJoin(orgs, eq(orgs.id, products.orgId)).where(and(eq(products.orgId, orgId), eq(products.id, productId))).limit(1);
  if (!row) throw new StudioError("Product not found.");
  const source = row.p.imageOriginalUrl ?? row.p.imageUrl;
  if (!source) throw new StudioError("Add a photo first.");
  const cutout = await removeBackground(source);
  const [cutoutUrl, studio] = await Promise.all([saveGeneratedImage(orgId, `${productId}-cutout`, cutout, "image/png"), studioShot(cutout, row.brand)]);
  const studioUrl = await saveGeneratedImage(orgId, `${productId}-studio`, studio, "image/webp");
  await db.update(products).set({ imageUrl: studioUrl, imageOriginalUrl: source, imageCutoutUrl: cutoutUrl, updatedAt: new Date() }).where(eq(products.id, productId));
  return studioUrl;
}

export async function undoStudioPhoto(orgId: number, productId: number) {
  const [p] = await db.select().from(products).where(and(eq(products.orgId, orgId), eq(products.id, productId))).limit(1);
  if (!p?.imageOriginalUrl) throw new StudioError("This photo isn't a studio photo.");
  await db.update(products).set({ imageUrl: p.imageOriginalUrl, imageOriginalUrl: null, imageCutoutUrl: null, updatedAt: new Date() }).where(eq(products.id, p.id));
}
