/**
 * "Usually buys": a customer's repeat items, ranked for the till.
 * Pure so it can be tested; the till action feeds it purchase history.
 */

export interface PurchaseRow {
  saleId: number;
  variantId: number;
  qty: number;
  date: string; // YYYY-MM-DD business date
}

export interface UsualItem {
  variantId: number;
  /** Separate visits this item was bought on. */
  times: number;
  /** Quantity bought last time — what one tap adds. */
  lastQty: number;
  lastDate: string;
  inLastVisit: boolean;
}

export function rankUsual(rows: PurchaseRow[], limit = 6): { items: UsualItem[]; lastVisit: string | null } {
  if (rows.length === 0) return { items: [], lastVisit: null };
  const lastSale = rows.reduce((a, r) => (r.date > a.date || (r.date === a.date && r.saleId > a.saleId) ? r : a)).saleId;
  const by = new Map<number, { sales: Set<number>; lastQty: number; lastDate: string; lastSale: number }>();
  for (const r of rows) {
    const e = by.get(r.variantId) ?? { sales: new Set<number>(), lastQty: 0, lastDate: "", lastSale: -1 };
    e.sales.add(r.saleId);
    if (r.date > e.lastDate || (r.date === e.lastDate && r.saleId >= e.lastSale)) {
      e.lastQty = r.saleId === e.lastSale ? e.lastQty + r.qty : r.qty;
      e.lastDate = r.date;
      e.lastSale = r.saleId;
    }
    by.set(r.variantId, e);
  }
  const items = [...by.entries()].map(([variantId, e]) => ({ variantId, times: e.sales.size, lastQty: e.lastQty, lastDate: e.lastDate, inLastVisit: e.lastSale === lastSale }));
  // Bought repeatedly first, then what they had last time, then most recent.
  items.sort((a, b) => b.times - a.times || Number(b.inLastVisit) - Number(a.inLastVisit) || b.lastDate.localeCompare(a.lastDate));
  const lastVisit = rows.find((r) => r.saleId === lastSale)!.date;
  return { items: items.slice(0, limit), lastVisit };
}
