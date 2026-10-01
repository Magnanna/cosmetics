import { test } from "node:test";
import assert from "node:assert/strict";
import { brandCss, brandPalette, DEFAULT_BRAND, luminance } from "../src/lib/brand";
import { ditherToRaster, fromBase64, toBase64 } from "../src/lib/logo-raster";
import { receiptBytes } from "../src/lib/escpos";
import type { ReceiptData } from "../src/lib/receipt";

test("default brand keeps the hand-tuned palette and injects no CSS", () => {
  assert.equal(brandCss(DEFAULT_BRAND), null);
  assert.equal(brandCss("#5a2132"), null);
  assert.equal(brandPalette(DEFAULT_BRAND).brandTint, "#f4e6ea");
});

test("dark brands get white text, pale brands get dark text", () => {
  assert.equal(brandPalette("#1E3A5F").brandInk, "#ffffff");
  const pale = brandPalette("#C6E385");
  assert.equal(pale.brandInk, "#1d1d1f");
  assert.ok(luminance(pale.brand700) < luminance(pale.brand), "accent text is darker than a pale brand");
});

test("brand CSS only accepts real hex colours (no CSS injection)", () => {
  assert.equal(brandCss("red;}body{display:none"), null);
  assert.equal(brandCss("#12345"), null);
  const css = brandCss("#0F766E")!;
  assert.match(css, /^:root\{--color-brand:#0f766e;/);
  assert.ok(!css.includes("<"));
});

test("raster: GS v 0 header, byte-padded width, black where dark", () => {
  // 10×2 image: left half black, right half white.
  const gray = new Uint8Array(20).map((_, i) => (i % 10 < 5 ? 0 : 255));
  const r = ditherToRaster(gray, 10, 2);
  assert.deepEqual([...r.slice(0, 8)], [0x1d, 0x76, 0x30, 0, 2, 0, 2, 0]);
  assert.equal(r.length, 8 + 2 * 2);
  assert.equal(r[8], 0b11111000); // first 5 dots black
  assert.equal(r[9], 0); // the rest white (padding stays white)
  assert.deepEqual(fromBase64(toBase64(r)), r);
});

test("printed receipt starts with the logo when the shop has one", () => {
  const logo = ditherToRaster(new Uint8Array(16).fill(0), 8, 2);
  const r: ReceiptData = {
    shop: { name: "Kenfri", address: null, phone: null, kraPin: null, footer: null, logoUrl: "https://x/logo.png", brandColor: DEFAULT_BRAND, logoPrint: toBase64(logo) },
    receiptNo: "KF-1", token: "t", createdAt: "2026-09-25T08:30:00.000Z", cashier: "A",
    customer: { name: null, phoneMasked: "07•••", pointsBalance: null },
    lines: [], grossCents: 0, discountCents: 0, totalCents: 0, payments: [], pointsEarned: 0,
  };
  const bytes = receiptBytes(r, { openDrawer: false, reprint: false });
  const at = bytes.findIndex((_, i) => bytes[i] === 0x1d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30);
  assert.ok(at > 0, "raster command present");
  assert.deepEqual([...bytes.slice(at, at + logo.length)], [...logo]);
  // Broken stored data never blocks the receipt.
  const bad = receiptBytes({ ...r, shop: { ...r.shop, logoPrint: "%%%not base64" } }, { openDrawer: false, reprint: false });
  assert.ok(bad.length > 0);
});

test("colour words for image prompts", async () => {
  const { colorWords } = await import("../src/lib/brand");
  assert.match(colorWords("#5A2132"), /burgundy/);
  assert.match(colorWords("#0F766E"), /teal/);
  assert.match(colorWords("#1E3A5F"), /navy/);
});
