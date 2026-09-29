import "server-only";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const IMAGE_BUCKET = "product-images";
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export class ImageError extends Error {}

function storage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ImageError("Photo uploads need SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).storage.from(IMAGE_BUCKET);
}

export function imagesEnabled(): boolean {
  return !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

/** Saves an image to our own storage and returns its public URL. */
export async function saveProductImage(orgId: number, productId: number, bytes: Uint8Array, contentType: string): Promise<string> {
  const ext = TYPES[contentType];
  if (!ext) throw new ImageError("Use a JPG, PNG or WebP photo.");
  if (bytes.byteLength > MAX_BYTES) throw new ImageError("That photo is bigger than 5 MB.");
  const path = `${orgId}/${productId}-${randomBytes(6).toString("hex")}.${ext}`;
  const s = storage();
  const { error } = await s.upload(path, bytes, { contentType, upsert: false, cacheControl: "31536000" });
  if (error) throw new ImageError(`Couldn't save the photo: ${error.message}`);
  return s.getPublicUrl(path).data.publicUrl;
}

/**
 * Copies a photo found by barcode lookup into our storage (so the till never
 * depends on someone else's server). HTTPS only, no IP-literal or local hosts.
 */
export async function copyRemoteImage(orgId: number, productId: number, url: string): Promise<string | null> {
  if (!imagesEnabled()) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || /^[\d.]+$|^\[|localhost|\.local$|\.internal$/i.test(u.hostname)) return null;
  try {
    const res = await fetch(u, { signal: AbortSignal.timeout(6000), redirect: "error" });
    const type = res.headers.get("content-type")?.split(";")[0] ?? "";
    if (!res.ok || !TYPES[type]) return null;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return await saveProductImage(orgId, productId, bytes, type);
  } catch {
    return null;
  }
}
