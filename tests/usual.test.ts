import { test } from "node:test";
import assert from "node:assert/strict";
import { rankUsual } from "../src/lib/usual";

test("repeat items rank first, then last visit; last qty is what a tap adds", () => {
  const r = rankUsual([
    { saleId: 1, variantId: 10, qty: 1, date: "2026-07-01" }, // relaxer
    { saleId: 1, variantId: 20, qty: 2, date: "2026-07-01" }, // foundation
    { saleId: 2, variantId: 10, qty: 2, date: "2026-08-05" },
    { saleId: 3, variantId: 30, qty: 1, date: "2026-09-12" }, // lipstick, last visit
    { saleId: 3, variantId: 10, qty: 1, date: "2026-09-12" },
  ]);
  assert.equal(r.lastVisit, "2026-09-12");
  assert.deepEqual(r.items.map((i) => i.variantId), [10, 30, 20]);
  assert.equal(r.items[0].times, 3);
  assert.equal(r.items[0].lastQty, 1);
  assert.equal(r.items[2].lastQty, 2);
  assert.ok(r.items[1].inLastVisit && !r.items[2].inLastVisit);
});

test("same item on two lines of one sale adds up; empty history is empty", () => {
  const r = rankUsual([
    { saleId: 5, variantId: 7, qty: 1, date: "2026-09-01" },
    { saleId: 5, variantId: 7, qty: 2, date: "2026-09-01" },
  ]);
  assert.equal(r.items[0].lastQty, 3);
  assert.equal(r.items[0].times, 1);
  assert.deepEqual(rankUsual([]), { items: [], lastVisit: null });
});
