/**
 * Loyalty card numbers: 14 digits = "98" + org (4) + customer id (7) + Luhn
 * check digit. Printed as a Code 128 barcode on the customer's card page;
 * the till scanner reads it like any barcode. Pure.
 */

function luhn(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

export function cardNumber(orgId: number, customerId: number): string {
  const body = `98${String(orgId).padStart(4, "0")}${String(customerId).padStart(7, "0")}`;
  return body + luhn(body);
}

/** The customer a scanned or typed card number points to, or null if it isn't a valid card. */
export function parseCardNumber(raw: string): { orgId: number; customerId: number } | null {
  const s = raw.replace(/\s/g, "");
  if (!/^98\d{12}$/.test(s)) return null;
  if (luhn(s.slice(0, 13)) !== Number(s[13])) return null;
  return { orgId: Number(s.slice(2, 6)), customerId: Number(s.slice(6, 13)) };
}

/** "9800 0100 0004 27" — easier to read aloud. */
export function formatCardNumber(n: string): string {
  return n.replace(/(\d{4})(?=\d)/g, "$1 ");
}
