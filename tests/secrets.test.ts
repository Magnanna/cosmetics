import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
process.env.SETTINGS_ENC_KEY = randomBytes(32).toString("base64");
const { encryptJson, decryptJson } = await import("../src/lib/secrets");

test("SMS keys round-trip encrypted; tampering is rejected", () => {
  const enc = encryptJson({ apiKey: "k", partnerId: "1", senderId: "KENFRI" });
  assert.ok(!enc.includes("KENFRI"));
  assert.deepEqual(decryptJson(enc), { apiKey: "k", partnerId: "1", senderId: "KENFRI" });
  const parts = enc.split(":");
  parts[2] = (parts[2][0] === "a" ? "b" : "a") + parts[2].slice(1);
  assert.equal(decryptJson(parts.join(":")), null);
});
