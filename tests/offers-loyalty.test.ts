import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOffers, type OfferDef, type PricedItem } from "../src/lib/offers";
import { canRedeem, centipointsFor, earnedCentipoints, pointsValueCents } from "../src/lib/loyalty";

const now = new Date("2026-10-03T10:00:00+03:00");
const base = { minSpendCents: 0, audience: "all" as const, startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-05T00:00:00Z", active: true };
const lipstick: PricedItem = { variantId: 1, productId: 10, brandId: 100, categoryIds: [7, 3], unitCents: 65_000, qty: 2 };
const relaxer: PricedItem = { variantId: 2, productId: 20, brandId: 200, categoryIds: [8, 1], unitCents: 12_000, qty: 1 };

test("best price offer wins, never stacks", () => {
  const offers: OfferDef[] = [
    { ...base, id: 1, title: "Lips 20% off", type: "percent_off", value: 2000, targets: [{ kind: "category", targetId: 3 }] },
    { ...base, id: 2, title: "KES 100 off brand", type: "amount_off", value: 10_000, targets: [{ kind: "brand", targetId: 100 }] },
    { ...base, id: 3, title: "Relaxer at 99", type: "fixed_price", value: 9_900, targets: [{ kind: "product", targetId: 20 }] },
  ];
  const r = applyOffers([lipstick, relaxer], offers, "retail", now);
  assert.deepEqual(r.lines.map((l) => [l.offerId, l.promoDiscountCents]), [[1, 26_000], [3, 2_100]]);
});

test("audience, window and inactive offers are ignored", () => {
  const offers: OfferDef[] = [
    { ...base, id: 1, title: "Retail only", type: "percent_off", value: 1000, audience: "retail", targets: [] },
    { ...base, id: 2, title: "Expired", type: "percent_off", value: 5000, endsAt: "2026-10-02T00:00:00Z", targets: [] },
    { ...base, id: 3, title: "Paused", type: "percent_off", value: 5000, active: false, targets: [] },
  ];
  assert.equal(applyOffers([relaxer], offers, "wholesale", now).lines[0].offerId, null);
  assert.equal(applyOffers([relaxer], offers, "retail", now).lines[0].offerId, 1);
});

test("bonus points need the minimum spend on target items; multipliers boost earning", () => {
  const offers: OfferDef[] = [
    { ...base, id: 4, title: "1,000 pts on KES 1,000 hair", type: "bonus_points", value: 100_000, minSpendCents: 100_000, targets: [{ kind: "category", targetId: 1 }] },
    { ...base, id: 5, title: "Double points on lips", type: "points_multiplier", value: 200, targets: [{ kind: "category", targetId: 3 }] },
  ];
  assert.equal(applyOffers([relaxer], offers, "retail", now).bonusCentipoints, 0);
  const r = applyOffers([{ ...relaxer, qty: 9 }, lipstick], offers, "retail", now);
  assert.equal(r.bonusCentipoints, 100_000);
  assert.deepEqual(r.lines.map((l) => l.pointsMultiplier), [100, 200]);
});

test("loyalty maths: 1 pt per KES 10, 1 pt = KES 0.10, redeem from KES 100", () => {
  const s = { earnCentsPerPoint: 1000, pointValueCents: 10, minRedeemCents: 10_000 };
  assert.equal(earnedCentipoints([{ paidCents: 125_050, multiplier: 100 }], s), 12_505); // KES 1,250.50 → 125.05 pts
  assert.equal(earnedCentipoints([{ paidCents: 10_000, multiplier: 200 }], s), 2_000);
  assert.equal(pointsValueCents(144_791, s), 14_479); // 1,447.91 pts = KES 144.79
  assert.equal(centipointsFor(14_479, s), 144_790);
  assert.ok(canRedeem(100_000, s));
  assert.ok(!canRedeem(99_999, s));
});
