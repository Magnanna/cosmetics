/**
 * Shop brand colour → the accent tokens the whole UI uses (see globals.css).
 * Pure, so the settings preview and the server render the same palette.
 */

export const DEFAULT_BRAND = "#5A2132";
const HEX = /^#[0-9a-f]{6}$/i;

export const BRAND_PRESETS: { name: string; hex: string }[] = [
  { name: "Masterpiece red", hex: "#5A2132" },
  { name: "Rose", hex: "#B4536A" },
  { name: "Plum", hex: "#5B2A5C" },
  { name: "Cocoa", hex: "#5C3A2E" },
  { name: "Forest", hex: "#1F5A45" },
  { name: "Teal", hex: "#0F766E" },
  { name: "Navy", hex: "#1E3A5F" },
  { name: "Charcoal", hex: "#2B2B2E" },
];

export function isHexColor(v: string): boolean {
  return HEX.test(v);
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]) {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;
}

/** Mix `hex` with `other` — `amount` is the share of `hex` (0–1). */
export function mix(hex: string, other: string, amount: number) {
  const a = rgb(hex);
  const b = rgb(other);
  return toHex([0, 1, 2].map((i) => a[i] * amount + b[i] * (1 - amount)) as [number, number, number]);
}

/** WCAG relative luminance, 0 (black) – 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export interface BrandPalette {
  brand: string;
  brand600: string; // hover
  brand700: string; // accent text on light surfaces
  brandInk: string; // text on the accent
  brandRing: string;
  brandTint: string;
  brandWash: string;
}

export function brandPalette(input: string | null | undefined): BrandPalette {
  const hex = input && isHexColor(input) ? input.toLowerCase() : DEFAULT_BRAND.toLowerCase();
  if (hex === DEFAULT_BRAND.toLowerCase()) {
    // The hand-tuned Kenfri palette from globals.css.
    return { brand: "#5a2132", brand600: "#6e2b3f", brand700: "#5a2132", brandInk: "#ffffff", brandRing: "#5a2132", brandTint: "#f4e6ea", brandWash: "#faf3f5" };
  }
  const L = luminance(hex);
  const light = L > 0.45; // pale brands (e.g. yellow-green) need dark text and a darker text accent
  return {
    brand: hex,
    brand600: light ? mix(hex, "#000000", 0.88) : mix(hex, "#ffffff", 0.86),
    brand700: L > 0.2 ? mix(hex, "#000000", L > 0.45 ? 0.5 : 0.7) : hex,
    brandInk: light ? "#1d1d1f" : "#ffffff",
    brandRing: L > 0.45 ? mix(hex, "#000000", 0.7) : hex,
    brandTint: mix(hex, "#ffffff", 0.14),
    brandWash: mix(hex, "#ffffff", 0.06),
  };
}

/** CSS that re-points the accent tokens at the shop's colour; null when it's the default. */
export function brandCss(input: string | null | undefined): string | null {
  if (!input || !isHexColor(input) || input.toLowerCase() === DEFAULT_BRAND.toLowerCase()) return null;
  const p = brandPalette(input);
  return `:root{--color-brand:${p.brand};--color-brand-600:${p.brand600};--color-brand-700:${p.brand700};--color-brand-ink:${p.brandInk};--color-brand-ring:${p.brandRing};--color-brand-tint:${p.brandTint};--color-brand-wash:${p.brandWash};--color-ring:${p.brandRing}}`;
}

/** Plain-English colour words for image prompts (models ignore hex codes). */
export function colorWords(input: string): string {
  const hex = isHexColor(input) ? input : DEFAULT_BRAND;
  const [r, g, b] = rgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (sat < 0.12) return l < 0.3 ? "charcoal grey" : l > 0.75 ? "soft warm white" : "neutral grey";
  const name =
    h < 15 || h >= 335 ? (l < 0.4 ? "wine burgundy" : "rose red")
    : h < 40 ? (l < 0.4 ? "cocoa brown" : "terracotta peach")
    : h < 65 ? "golden yellow"
    : h < 160 ? (l < 0.4 ? "forest green" : "sage green")
    : h < 200 ? "teal"
    : h < 250 ? (l < 0.4 ? "navy blue" : "sky blue")
    : h < 290 ? (l < 0.4 ? "deep purple" : "lavender")
    : l < 0.4 ? "plum" : "dusty rose";
  return `${l < 0.3 ? "deep " : l > 0.72 ? "pale " : ""}${name}`;
}
