import { test } from "node:test";
import assert from "node:assert/strict";
import { billTotals, landedLine } from "../src/lib/landed-cost";
import { normalizeKenyanPhone, maskPhone } from "../src/lib/phone";
import { ean13CheckDigit, inStoreEan13, isValidEan13 } from "../src/lib/barcode";
import { allocate, fmtKES, parseKES } from "../src/lib/money";

test("Lush invoice: VAT-inclusive rates sum to 6,960 with 6,000 net", () => {
  const inputs = [2500, 2000, 3500, 6500].map((rate) => ({ qty: 48, unitsPerUom: 1, rateCents: rate, vatBp: 1600, rateIncludesVat: true }));
  assert.deepEqual(billTotals(inputs), { netCents: 600_000, vatCents: 96_000, totalCents: 696_000 });
  assert.equal(landedLine(inputs[0]).unitCostCents, 2500); // leave-in really costs KES 25.00
});

test("VAT-exclusive rate adds 16% on top", () => {
  const r = landedLine({ qty: 2, unitsPerUom: 48, rateCents: 120_000, vatBp: 1600, rateIncludesVat: false });
  assert.equal(r.units, 96);
  assert.equal(r.totalCents, 278_400);
  assert.equal(r.vatCents, 38_400);
});

test("phone normalisation", () => {
  for (const input of ["0714733287", "+254 714 733 287", "254714733287", "714733287", "0714-733-287"]) {
    assert.equal(normalizeKenyanPhone(input), "254714733287", input);
  }
  assert.equal(normalizeKenyanPhone("0110123456"), "254110123456");
  assert.equal(normalizeKenyanPhone("0514733287"), null);
  assert.equal(normalizeKenyanPhone("12345"), null);
  assert.equal(maskPhone("254714733287"), "0714 ••• 287");
});

test("EAN-13 check digits", () => {
  assert.equal(ean13CheckDigit("400638133393"), 1); // 4006381333931 is a real EAN
  assert.ok(isValidEan13("4006381333931"));
  const code = inStoreEan13(1, 42);
  assert.match(code, /^201000000042\d$/);
  assert.ok(isValidEan13(code));
});

test("money helpers", () => {
  assert.equal(fmtKES(696_000), "KES 6,960.00");
  assert.equal(parseKES("1,250.50"), 125_050);
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33]);
  assert.equal(allocate(1001, [3, 7]).reduce((a, b) => a + b), 1001);
});
