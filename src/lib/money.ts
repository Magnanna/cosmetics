/** KES money helpers. All amounts are integer cents. */

export function fmtKES(cents: number, opts?: { signed?: boolean; symbol?: boolean }): string {
  const sign = cents < 0 ? "-" : opts?.signed && cents > 0 ? "+" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-KE");
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${sign}${opts?.symbol === false ? "" : "KES "}${whole}.${frac}`;
}

/** Parses "1,250.50" into cents. Returns NaN if invalid. */
export function parseKES(input: string): number {
  const cleaned = input.replace(/[^0-9.\-]/g, "");
  if (!cleaned) return NaN;
  const v = Number(cleaned);
  return Number.isFinite(v) ? Math.round(v * 100) : NaN;
}

/** Splits `total` across `weights` so the parts always sum exactly to `total`. */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) out[order[k][1]]++;
  return out;
}
