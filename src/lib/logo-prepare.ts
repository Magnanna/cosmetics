import sharp from "sharp";
import { ditherToRaster, LOGO_MAX_HEIGHT_DOTS, LOGO_MAX_WIDTH_DOTS } from "./logo-raster";

/**
 * Uploaded logo → a trimmed PNG for screens (transparency kept, max 800px)
 * and a black-and-white ESC/POS raster sized for 80mm thermal paper.
 */
export async function prepareLogo(bytes: Uint8Array): Promise<{ png: Buffer; raster: Uint8Array }> {
  const png = await sharp(bytes, { limitInputPixels: 40_000_000 })
    .rotate()
    .trim({ threshold: 10 })
    .resize({ width: 800, height: 800, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  const { data, info } = await sharp(png)
    .flatten({ background: "#ffffff" })
    .resize({ width: LOGO_MAX_WIDTH_DOTS, height: LOGO_MAX_HEIGHT_DOTS, fit: "inside" })
    .greyscale()
    .normalise() // stretch to full black/white so brand colours print solid, not speckled
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { png, raster: ditherToRaster(new Uint8Array(data), info.width, info.height) };
}
