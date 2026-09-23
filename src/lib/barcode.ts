/** EAN-13 helpers. In-store codes use the GS1 restricted prefixes 20–29. */

export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new Error("EAN-13 body must be 12 digits");
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/**
 * Builds an in-store EAN-13: "2" + 2-digit org tag + 9-digit sequence + check.
 * The org tag keeps codes distinct if two shops ever share printed labels.
 */
export function inStoreEan13(orgId: number, sequence: number): string {
  if (sequence < 0 || sequence > 999_999_999) throw new Error("Barcode sequence out of range");
  const orgTag = String(orgId % 100).padStart(2, "0");
  const body = `2${orgTag}${String(sequence).padStart(9, "0")}`;
  return body + ean13CheckDigit(body);
}
