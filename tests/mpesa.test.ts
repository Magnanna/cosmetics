import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDate, parseMpesaStatement } from "../src/lib/mpesa-statement";

const sample = `Organization Name:,KENFRI COSMETICS
Till Number:,123456
"Receipt No.","Completion Time","Initiation Time","Details","Transaction Status","Paid In","Withdrawn","Balance","Balance Confirmed","Reason Type","Other Party Info","Linked Transaction ID","A/C No."
SJK4H7QX2M,30-09-2026 14:22:10,30-09-2026 14:22:08,"Pay Merchant from 2547****287 - FRIDAH M",Completed,"1,020.00",,"5,020.00",true,Pay Merchant,,,
SJK4H7QX3N,30-09-2026 15:01:00,30-09-2026 15:01:00,Withdrawal to bank,Completed,,"4,000.00","1,020.00",true,Withdrawal,,,
SJK4H7QX4P,30-09-2026 15:30:00,30-09-2026 15:30:00,Pay Merchant,Failed,"500.00",,,,,,,
`;

test("parses a portal export, skipping title rows and failed lines", () => {
  const rows = parseMpesaStatement(sample);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { code: "SJK4H7QX2M", completedAt: "2026-09-30 14:22:10", details: "Pay Merchant from 2547****287 - FRIDAH M", paidInCents: 102_000, withdrawnCents: 0 });
  assert.equal(rows[1].withdrawnCents, 400_000);
});

test("rejects files that aren't statements", () => {
  assert.throws(() => parseMpesaStatement("name,phone\nAnn,0712"), /doesn't look like an M-Pesa statement/);
});

test("date formats", () => {
  assert.equal(normalizeDate("2026-09-30 08:05:00"), "2026-09-30 08:05:00");
  assert.equal(normalizeDate("1/10/2026 8:05"), "2026-10-01 08:05:00");
  assert.equal(normalizeDate("yesterday"), null);
});
