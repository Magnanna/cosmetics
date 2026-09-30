import { test } from "node:test";
import assert from "node:assert/strict";
import { cardNumber, formatCardNumber, parseCardNumber } from "../src/lib/card";

test("card number round-trips and rejects typos", () => {
  const n = cardNumber(1, 42);
  assert.equal(n.length, 14);
  assert.ok(n.startsWith("98"));
  assert.deepEqual(parseCardNumber(n), { orgId: 1, customerId: 42 });
  assert.deepEqual(parseCardNumber(formatCardNumber(n)), { orgId: 1, customerId: 42 });
  const typo = n.slice(0, 10) + String((Number(n[10]) + 1) % 10) + n.slice(11);
  assert.equal(parseCardNumber(typo), null);
  assert.equal(parseCardNumber("0712345678"), null);
  assert.equal(parseCardNumber("6161234567890"), null); // product EAN
});
