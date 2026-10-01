/**
 * Smart reorder: how many to order so the shelf lasts until the delivery
 * arrives plus `coverDays` more. Pure — the page feeds it sales and stock.
 */

export const VELOCITY_DAYS = 56; // 8 weeks of sales

export interface ReorderInput {
  soldUnits: number; // over VELOCITY_DAYS
  onHand: number;
  leadDays: number;
  coverDays: number;
  unitsPerPack: number; // supplier pack size (1 = single pieces)
  reorderLevel: number;
}

export interface ReorderSuggestion {
  perDay: number;
  daysLeft: number | null; // null when it isn't selling
  units: number; // suggested units (a whole number of packs)
  packs: number;
  urgent: boolean; // runs out before a new order could arrive
}

export function suggestReorder(i: ReorderInput): ReorderSuggestion | null {
  const perDay = i.soldUnits / VELOCITY_DAYS;
  const onHand = Math.max(0, i.onHand);
  const fromSales = Math.ceil(perDay * (i.leadDays + i.coverDays));
  // Slow or new items still keep a minimum on the shelf if a reorder level is set.
  const target = Math.max(fromSales, i.reorderLevel > 0 ? i.reorderLevel * 2 : 0);
  const need = target - onHand;
  const belowLevel = i.reorderLevel > 0 && onHand <= i.reorderLevel;
  const daysLeft = perDay > 0 ? onHand / perDay : null;
  // Only suggest when stock won't last through the lead time + cover, or it's under its reorder level.
  if (need <= 0 || (!belowLevel && daysLeft !== null && daysLeft > i.leadDays + i.coverDays * 0.5)) return null;
  if (need <= 0 || (perDay === 0 && !belowLevel)) return null;
  const pack = Math.max(1, i.unitsPerPack);
  const packs = Math.ceil(need / pack);
  return { perDay, daysLeft, units: packs * pack, packs, urgent: daysLeft !== null ? daysLeft <= i.leadDays : onHand === 0 };
}

/** SMS/WhatsApp text for one supplier. */
export function orderMessage(p: { shopName: string; shopPhone: string | null; lines: { name: string; code: string | null; packs: number; uom: string; units: number }[] }): string {
  const lines = p.lines.map((l, n) => `${n + 1}. ${l.name}${l.code ? ` (${l.code})` : ""} - ${l.packs} ${l.uom}${l.uom !== "PCS" ? ` = ${l.units} pcs` : ""}`);
  return [`Order from ${p.shopName}:`, ...lines, `Please confirm price and delivery date.${p.shopPhone ? ` Tel ${p.shopPhone.replace(/^254/, "0")}` : ""}`].join("\n");
}
