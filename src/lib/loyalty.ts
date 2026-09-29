/**
 * Loyalty maths (pure). Points are held in centipoints (hundredths).
 * Default: 1 point per KES 10 spent, 1 point = KES 0.10, redeem from KES 100.
 */

export interface LoyaltySettings {
  earnCentsPerPoint: number; // 1000 = 1 pt per KES 10
  pointValueCents: number; // 10 = KES 0.10
  minRedeemCents: number; // 10_000 = KES 100
}

/** Points earned on the amount actually paid for each line, with any multiplier (×100). */
export function earnedCentipoints(lines: { paidCents: number; multiplier: number }[], s: LoyaltySettings): number {
  const boosted = lines.reduce((sum, l) => sum + (l.paidCents * l.multiplier) / 100, 0);
  return Math.floor((boosted * 100) / s.earnCentsPerPoint);
}

/** KES value of points, in whole cents (rounded down — never over-promise). */
export function pointsValueCents(centipoints: number, s: LoyaltySettings): number {
  return Math.floor((centipoints * s.pointValueCents) / 100);
}

/** Points needed to pay `amountCents` (rounded up so the shop is never short). */
export function centipointsFor(amountCents: number, s: LoyaltySettings): number {
  return Math.ceil((amountCents * 100) / s.pointValueCents);
}

export function canRedeem(balanceCentipoints: number, s: LoyaltySettings): boolean {
  return pointsValueCents(balanceCentipoints, s) >= s.minRedeemCents;
}

export function fmtPoints(centipoints: number): string {
  return (centipoints / 100).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
