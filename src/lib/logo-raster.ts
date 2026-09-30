/**
 * Turns a greyscale image into an ESC/POS raster command (GS v 0) for
 * thermal printers. Pure: the server runs it once when the logo is uploaded
 * and stores the result, so printing a receipt stays instant.
 */

/** XP-Q80: 80mm paper, 576 printable dots. Keep the logo to two-thirds of it. */
export const LOGO_MAX_WIDTH_DOTS = 384;
export const LOGO_MAX_HEIGHT_DOTS = 160;

/**
 * Atkinson dithering (crisp on flat logos, still readable on photos),
 * packed 8 dots per byte, MSB first, 1 = black. Width is padded to a byte.
 */
export function ditherToRaster(gray: Uint8Array, width: number, height: number): Uint8Array {
  if (gray.length !== width * height) throw new Error("Pixel count doesn't match the size.");
  const px = Float32Array.from(gray);
  const bytesPerRow = Math.ceil(width / 8);
  const out = new Uint8Array(8 + bytesPerRow * height);
  out.set([0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, height & 0xff, height >> 8]);
  const spread: [number, number][] = [[1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = px[i];
      const black = old < 128;
      const err = (old - (black ? 0 : 255)) / 8;
      if (black) out[8 + y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      for (const [dx, dy] of spread) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny < height) px[ny * width + nx] += err;
      }
    }
  }
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
