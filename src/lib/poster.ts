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
  return `Minimal, elegant beauty product advertising backdrop. Soft studio light, smooth seamless paper background in a delicate tint of ${brandHex}, a simple round podium in the lower middle, subtle soft shadows, a few out-of-focus abstract shapes at the edges. Empty scene: no products, no people, no text, no letters, no logos. Clean, premium, lots of empty space in the top third.`;
}
