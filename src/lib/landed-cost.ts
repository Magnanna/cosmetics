/**
 * Kenfri is not VAT registered, so supplier VAT cannot be claimed back — the
 * full VAT-inclusive amount is what stock costs. Suppliers print rates either
 * way: Tolaram/Lush lists VAT-inclusive rates (lines sum to 6,960 = total,
 * with 6,000 net backed out), others list net rates and add VAT on top.
 * All maths in integer cents.
 */
export interface BillLineInput {
  /** Quantity in the supplier's unit (e.g. cartons). */
  qty: number;
  /** Units per supplier unit (e.g. 48 per carton). */
  unitsPerUom: number;
  /** Supplier's rate per supplier unit, in cents. */
  rateCents: number;
  /** VAT rate in basis points (1600 = 16%). */
  vatBp: number;
  /** True when the printed rate already includes VAT. */
  rateIncludesVat: boolean;
}

export interface LandedLine {
  units: number;
  netCents: number;
  vatCents: number;
  /** What goes into Inventory and Accounts Payable: net + VAT. */
  totalCents: number;
  /** For display only — FIFO uses totalCents, never a rounded unit cost. */
  unitCostCents: number;
}

export function landedLine(l: BillLineInput): LandedLine {
  const units = l.qty * l.unitsPerUom;
  const lineCents = l.qty * l.rateCents;
  let netCents: number;
  let totalCents: number;
  if (l.rateIncludesVat) {
    totalCents = lineCents;
    netCents = Math.round((lineCents * 10_000) / (10_000 + l.vatBp));
  } else {
    netCents = lineCents;
    totalCents = lineCents + Math.round((lineCents * l.vatBp) / 10_000);
  }
  return {
    units,
    netCents,
    vatCents: totalCents - netCents,
    totalCents,
    unitCostCents: units > 0 ? Math.round(totalCents / units) : 0,
  };
}

/** Invoice-level totals the way suppliers print them: VAT backed out of (or added to) the whole invoice. */
export function billTotals(lines: BillLineInput[]): { netCents: number; vatCents: number; totalCents: number } {
  const totalCents = lines.reduce((s, l) => s + landedLine(l).totalCents, 0);
  const vatBp = lines[0]?.vatBp ?? 0;
  const netCents = Math.round((totalCents * 10_000) / (10_000 + vatBp));
  return { netCents, vatCents: totalCents - netCents, totalCents };
}
