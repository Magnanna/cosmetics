import { colorWords } from "./brand";

/** Poster wording for an offer — exact text the app draws (never left to an image model). Pure. */

export function offerHeadline(type: string, value: number): string {
  switch (type) {
    case "percent_off": return `${+(value / 100).toFixed(2)}% OFF`;
    case "amount_off": return `KES ${(value / 100).toLocaleString("en-KE")} OFF`;
    case "fixed_price": return `NOW KES ${(value / 100).toLocaleString("en-KE")}`;
    case "bonus_points": return `+${(value / 100).toLocaleString("en-KE")} BONUS POINTS`;
    case "points_multiplier": return `${+(value / 100).toFixed(2)}× POINTS`;
    default: return "SPECIAL OFFER";
  }
}

/** Price after the offer for one unit, when the offer changes the price. */
export function offerPrice(type: string, value: number, priceCents: number): number | null {
  if (type === "percent_off") return Math.max(0, Math.round(priceCents * (1 - value / 10_000)));
  if (type === "amount_off") return Math.max(0, priceCents - value);
  if (type === "fixed_price") return value;
  return null;
}

export function backdropPrompt(brandHex: string): string {
  const c = colorWords(brandHex);
  return `High-key, bright and airy minimal beauty product advertising backdrop. Mostly very light: a near-white seamless paper background with a soft pastel blush of ${c}, gentle diffused daylight, no dark areas. A simple round podium in a slightly deeper pastel ${c} in the lower middle, soft shadows, a few out-of-focus pastel shapes at the edges. Empty scene: no products, no people, no text, no letters, no logos. Lots of clean, light empty space in the top half.`;}
