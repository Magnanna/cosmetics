import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db, barcodeLibrary, photoTokens, products, variantBarcodes, variants } from "@/db";
import { ImageError, saveProductImage } from "@/lib/images";
import { openPhotoToken } from "@/lib/photo-tokens";

/** Phone upload for a product photo. The single-use token in the URL is the credential. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = await openPhotoToken(token);
  if (!row) return NextResponse.json({ error: "This link has expired. Get a new one from the till." }, { status: 410 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("photo");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "No photo received." }, { status: 400 });

  // Claim the token first so two uploads can't both succeed.
  const claimed = await db
    .update(photoTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(photoTokens.token, token), isNull(photoTokens.usedAt)))
    .returning({ token: photoTokens.token });
  if (claimed.length === 0) return NextResponse.json({ error: "This link was already used." }, { status: 410 });

  try {
    const url = await saveProductImage(row.t.orgId, row.t.productId, new Uint8Array(await file.arrayBuffer()), file.type || "image/jpeg");
    await db.update(products).set({ imageUrl: url, updatedAt: new Date() }).where(and(eq(products.orgId, row.t.orgId), eq(products.id, row.t.productId)));
    // Share the photo with the barcode library for this product's manufacturer barcodes.
    const codes = await db
      .select({ code: variantBarcodes.code })
      .from(variantBarcodes)
      .innerJoin(variants, eq(variants.id, variantBarcodes.variantId))
      .where(and(eq(variants.productId, row.t.productId), eq(variantBarcodes.source, "manufacturer")));
    for (const { code } of codes) await db.update(barcodeLibrary).set({ imageUrl: url }).where(and(eq(barcodeLibrary.code, code), isNull(barcodeLibrary.imageUrl)));
    return NextResponse.json({ ok: true });
  } catch (e) {
    // Give the link back so they can retry.
    await db.update(photoTokens).set({ usedAt: null }).where(eq(photoTokens.token, token));
    const message = e instanceof ImageError ? e.message : "Couldn't save the photo. Try again.";
    if (!(e instanceof ImageError)) console.error(e);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
