import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { prepareLogo } from "../src/lib/logo-prepare";

test("logo: transparent PNG is trimmed, kept for screens, and rasterised for 80mm paper", async () => {
  // 1200×600 transparent canvas with a wine-coloured rounded box and white "K"-ish bar in the middle.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600">
    <rect x="300" y="150" width="600" height="300" rx="60" fill="#5A2132"/>
    <rect x="560" y="200" width="80" height="200" fill="#ffffff"/></svg>`;
  const input = await sharp(Buffer.from(svg)).png().toBuffer();
  const { png, raster } = await prepareLogo(new Uint8Array(input));
  const meta = await sharp(png).metadata();
  assert.equal(meta.width, 600, "transparent margins trimmed");
  assert.equal(meta.hasAlpha, true, "transparency kept");
  const bytesPerRow = raster[4] + raster[5] * 256;
  const height = raster[6] + raster[7] * 256;
  assert.ok(bytesPerRow * 8 <= 384 && height <= 160, "fits the printable width");
  assert.equal(raster.length, 8 + bytesPerRow * height);
  // Middle row: dark box edges print black, the white bar in the centre stays white.
  const row = raster.subarray(8 + Math.floor(height / 2) * bytesPerRow, 8 + (Math.floor(height / 2) + 1) * bytesPerRow);
  assert.equal(row[1], 0xff);
  assert.equal(row[Math.floor(bytesPerRow / 2)], 0x00);
});
