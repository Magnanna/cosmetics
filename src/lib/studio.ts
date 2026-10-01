import sharp from "sharp";
import { brandPalette, mix } from "./brand";

/**
 * Studio product photo: the cut-out product centred on a soft backdrop in the
 * shop's brand tint, with a gentle floor shadow. Same look for every product.
 */
export const STUDIO_SIZE = 1200;

export async function studioShot(cutoutPng: Uint8Array, brandColor: string): Promise<Buffer> {
  const S = STUDIO_SIZE;
  const p = brandPalette(brandColor);
  const top0 = mix(p.brand, "#ffffff", 0.05);
  const bottom0 = mix(p.brand, "#ffffff", 0.13);
  // Trim transparent margins and fit into ~74% of the frame.
  const product = await sharp(cutoutPng).trim({ threshold: 1 }).resize({ width: Math.round(S * 0.74), height: Math.round(S * 0.72), fit: "inside" }).png().toBuffer();
  const meta = await sharp(product).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  // Tall products stand near the bottom; wide or flat ones sit centred. The shadow follows.
  const top = Math.round(Math.min(S * 0.86 - h, S * 0.52 - h / 2));
  const floor = top + h;
  const backdrop = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top0}"/><stop offset="0.62" stop-color="#ffffff"/><stop offset="1" stop-color="${bottom0}"/></linearGradient>
      <radialGradient id="s" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#000" stop-opacity="0.22"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="${S}" height="${S}" fill="url(#g)"/>
    <ellipse cx="${S / 2}" cy="${floor + S * 0.012}" rx="${Math.max(w * 0.42, S * 0.12)}" ry="${S * 0.03}" fill="url(#s)"/>
  </svg>`);
  return sharp(backdrop)
    .composite([{ input: product, left: Math.round((S - w) / 2), top }])
    .webp({ quality: 88 })
    .toBuffer();
}
