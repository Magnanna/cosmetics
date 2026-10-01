import { test } from "node:test";
import assert from "node:assert/strict";
import { orderMessage, suggestReorder } from "../src/lib/reorder";

const base = { leadDays: 7, coverDays: 14, unitsPerPack: 1, reorderLevel: 0 };

test("fast seller: orders enough for lead time + cover, rounded to packs", () => {
  // 56 sold in 8 weeks = 1/day; needs 21, has 4 → 17 → 2 packs of 12 = 24.
  const s = suggestReorder({ ...base, soldUnits: 56, onHand: 4, unitsPerPack: 12 })!;
  assert.equal(s.perDay, 1);
  assert.equal(s.packs, 2);
  assert.equal(s.units, 24);
  assert.equal(s.urgent, true);
});

test("plenty on the shelf: no suggestion", () => {
  assert.equal(suggestReorder({ ...base, soldUnits: 56, onHand: 40 }), null);
});

test("not selling but under reorder level: tops up to twice the level", () => {
  const s = suggestReorder({ ...base, soldUnits: 0, onHand: 1, reorderLevel: 3 })!;
  assert.equal(s.units, 5);
  assert.equal(s.daysLeft, null);
});

test("dead stock with no reorder level is never suggested", () => {
  assert.equal(suggestReorder({ ...base, soldUnits: 0, onHand: 0 }), null);
});

test("supplier message lists packs and pieces", () => {
  const m = orderMessage({ shopName: "Kenfri", shopPhone: "254714733287", lines: [{ name: "Leave-in 40g", code: "LS12", packs: 2, uom: "CTN", units: 24 }] });
  assert.match(m, /1\. Leave-in 40g \(LS12\) - 2 CTN = 24 pcs/);
  assert.match(m, /Tel 0714733287/);
});
