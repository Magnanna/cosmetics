/**
 * Offers engine — pure, so the till screen and the server price a cart the
 * same way. Price offers (percent/amount off, fixed price): the best one for
 * the customer wins per line, never stacked. Bonus-point offers pay out once
 * per sale when spend on the target items reaches the minimum. Points
 * multipliers boost earning on target items.
 */

export type OfferType = "percent_off" | "amount_off" | "fixed_price" | "bonus_points" | "points_multiplier";

export interface OfferDef {
  id: number;
  title: string;
  type: OfferType;
  value: number;
  minSpendCents: number;
  audience: "all" | "retail" | "wholesale";
  startsAt: string; // ISO
  endsAt: string;
  active: boolean;
  /** Empty = every item. */
  targets: { kind: "variant" | "product" | "brand" | "category"; targetId: number }[];
}

export interface PricedItem {
  variantId: number;
  productId: number;
  brandId: number | null;
  /** The item's category and its parent, so a parent-category offer matches. */
  categoryIds: number[];
  unitCents: number;
  qty: number;
}

export interface LineOffer {
  offerId: number | null;
  offerTitle: string | null;
  promoDiscountCents: number;
  /** Points multiplier ×100 for earning on this line (100 = normal). */
  pointsMultiplier: number;
}

export interface OffersResult {
  lines: LineOffer[];
  bonusCentipoints: number;
  bonusOffers: { id: number; title: string; centipoints: number }[];
}

export function isLive(o: OfferDef, now: Date, customerType: "retail" | "wholesale"): boolean {
  return o.active && new Date(o.startsAt) <= now && now < new Date(o.endsAt) && (o.audience === "all" || o.audience === customerType);
}

export function targets(o: OfferDef, item: PricedItem): boolean {
  if (o.targets.length === 0) return true;
  return o.targets.some(
    (t) =>
      (t.kind === "variant" && t.targetId === item.variantId) ||
      (t.kind === "product" && t.targetId === item.productId) ||
      (t.kind === "brand" && t.targetId === item.brandId) ||
      (t.kind === "category" && item.categoryIds.includes(t.targetId))
  );
}

/** Discount per unit an offer gives on a price (never more than the price). */
export function unitDiscount(o: OfferDef, unitCents: number): number {
  let d = 0;
  if (o.type === "percent_off") d = Math.round((unitCents * o.value) / 10_000);
  else if (o.type === "amount_off") d = o.value;
  else if (o.type === "fixed_price") d = unitCents - o.value;
  return Math.max(0, Math.min(unitCents, d));
}

export function applyOffers(items: PricedItem[], allOffers: OfferDef[], customerType: "retail" | "wholesale", now = new Date()): OffersResult {
  const live = allOffers.filter((o) => isLive(o, now, customerType));
  const priceOffers = live.filter((o) => o.type === "percent_off" || o.type === "amount_off" || o.type === "fixed_price");
  const multipliers = live.filter((o) => o.type === "points_multiplier");

  const lines: LineOffer[] = items.map((item) => {
    let best: { offer: OfferDef; perUnit: number } | null = null;
    for (const o of priceOffers) {
      if (!targets(o, item)) continue;
      const perUnit = unitDiscount(o, item.unitCents);
      if (perUnit > 0 && (!best || perUnit > best.perUnit)) best = { offer: o, perUnit };
    }
    const mult = multipliers.filter((o) => targets(o, item)).reduce((m, o) => Math.max(m, o.value), 100);
    return {
      offerId: best?.offer.id ?? null,
      offerTitle: best?.offer.title ?? null,
      promoDiscountCents: best ? best.perUnit * item.qty : 0,
      pointsMultiplier: mult,
    };
  });

  const bonusOffers: OffersResult["bonusOffers"] = [];
  for (const o of live.filter((x) => x.type === "bonus_points")) {
    const spend = items.reduce((s, item, i) => (targets(o, item) ? s + item.unitCents * item.qty - lines[i].promoDiscountCents : s), 0);
    if (spend > 0 && spend >= o.minSpendCents) bonusOffers.push({ id: o.id, title: o.title, centipoints: o.value });
  }
  return { lines, bonusCentipoints: bonusOffers.reduce((s, b) => s + b.centipoints, 0), bonusOffers };
}
