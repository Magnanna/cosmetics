import { test } from "node:test";
import assert from "node:assert/strict";
import { offerHeadline, offerPrice } from "../src/lib/poster";

test("poster headline and price follow the offer exactly", () => {
  assert.equal(offerHeadline("percent_off", 2000), "20% OFF");
  assert.equal(offerHeadline("amount_off", 10_000), "KES 100 OFF");
  assert.equal(offerHeadline("fixed_price", 49_900), "NOW KES 499");
  assert.equal(offerHeadline("points_multiplier", 200), "2× POINTS");
  assert.equal(offerPrice("percent_off", 2000, 50_000), 40_000);
  assert.equal(offerPrice("amount_off", 10_000, 5_000), 0);
  assert.equal(offerPrice("bonus_points", 500, 5_000), null);
});
