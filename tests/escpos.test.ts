import { test } from "node:test";
import assert from "node:assert/strict";
import { receiptBytes } from "../src/lib/escpos";
import type { ReceiptData } from "../src/lib/receipt";

const sample: ReceiptData = {
  shop: { name: "Kenfri Cosmetics", address: "Cheptulu Market", phone: "0714 733 287", kraPin: null, footer: "Returns within 24 hrs, unopened items only. Thank you!", logoUrl: null, brandColor: "#5A2132", logoPrint: null },
  receiptNo: "KF-000042",
  token: "abc",
  createdAt: "2026-09-25T08:30:00.000Z",
  cashier: "Wanjiru",
  customer: { name: "Fridah", phoneMasked: "0714 ••• 287", pointsBalance: 144_791 },
  lines: [
    { description: "Lush Hair Wet Hair Daily Leave-in Treatment 40g", qty: 3, unitCents: 5_000, totalCents: 15_000, discountCents: 0 },
    { description: "Foundation · Caramel", qty: 1, unitCents: 120_000, totalCents: 110_000, discountCents: 10_000 },
  ],
  grossCents: 135_000,
  discountCents: 10_000,
  totalCents: 125_000,
  payments: [{ method: "cash", amountCents: 125_000, tenderedCents: 200_000, changeCents: 75_000, mpesaCode: null }],
  pointsEarned: 12_500,
};

/** Printable text only, skipping the ESC/GS command sequences the builder emits. */
function text(b: Uint8Array): string {
  let out = "";
  for (let i = 0; i < b.length; ) {
    const c = b[i];
    if (c === 0x1b) {
      const cmd = String.fromCharCode(b[i + 1]);
      i += cmd === "@" ? 2 : cmd === "p" ? 5 : 3;
    } else if (c === 0x1d) {
      const cmd = String.fromCharCode(b[i + 1]);
      i += cmd === "(" ? 5 + b[i + 3] + b[i + 4] * 256 : cmd === "v" ? 8 + (b[i + 4] + b[i + 5] * 256) * (b[i + 6] + b[i + 7] * 256) : 3;
    } else {
      if ((c >= 0x20 && c < 0x7f) || c === 10) out += String.fromCharCode(c);
      i++;
    }
  }
  return out;
}

test("receipt fits 48 columns and carries the essentials", () => {
  const bytes = receiptBytes(sample, { openDrawer: false, reprint: false });
  const out = text(bytes);
  for (const line of out.split("\n")) assert.ok(line.length <= 48, `too wide: "${line}"`);
  assert.match(out, /Receipt KF-000042/);
  assert.match(out, /TOTAL\s+1,250\.00/);
  assert.match(out, /Change\s+750\.00/);
  assert.match(out, /Points balance\s+1447\.91/);
  assert.match(out, /Returns within 24 hrs/);
  assert.doesNotMatch(out, /•/); // non-ASCII stripped for the printer
  assert.deepEqual(Array.from(bytes.slice(-3)), [0x1d, 0x56, 0x01]); // ends with a cut
});

test("drawer kick only for cash, and a reprint is marked", () => {
  const withDrawer = receiptBytes(sample, { openDrawer: true, reprint: true });
  assert.deepEqual(Array.from(withDrawer.slice(2, 7)), [0x1b, 0x70, 0x00, 0x19, 0xfa]);
  assert.match(text(withDrawer), /\*\*\* REPRINT \*\*\*/);
  const without = receiptBytes(sample, { openDrawer: false, reprint: false });
  assert.notDeepEqual(Array.from(without.slice(2, 5)), [0x1b, 0x70, 0x00]);
});
