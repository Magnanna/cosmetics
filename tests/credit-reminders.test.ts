import { test } from "node:test";
import assert from "node:assert/strict";
import { oldestUnpaid, reminderStage, reminderText } from "../src/lib/credit-reminder-rules";

test("reminder schedule: 3 days before, due day, then weekly for 8 weeks", () => {
  assert.deepEqual(reminderStage("2026-10-10", "2026-10-07"), { stage: "before", daysLate: 0 });
  assert.deepEqual(reminderStage("2026-10-10", "2026-10-10"), { stage: "due", daysLate: 0 });
  assert.deepEqual(reminderStage("2026-10-10", "2026-10-17"), { stage: "overdue", daysLate: 7 });
  assert.equal(reminderStage("2026-10-10", "2026-10-12"), null);
  assert.equal(reminderStage("2026-10-10", "2026-12-12"), null); // past 8 weeks
});

test("payments clear the oldest purchases first", () => {
  const lines = [
    { date: "2026-09-01", chargeCents: 100_000, paymentCents: 0 },
    { date: "2026-09-10", chargeCents: 50_000, paymentCents: 0 },
    { date: "2026-09-15", chargeCents: 0, paymentCents: 120_000 },
  ];
  assert.deepEqual(oldestUnpaid(lines, 0), { date: "2026-09-10", owedCents: 30_000 });
  assert.equal(oldestUnpaid([...lines, { date: "2026-09-20", chargeCents: 0, paymentCents: 30_000 }], 0), null);
});

test("reminder wording", () => {
  const t = reminderText({ shop: "Kenfri Cosmetics", name: "Mama Salon", owedCents: 1_250_000, dueDate: "2026-10-10", stage: "overdue", daysLate: 14 });
  assert.match(t, /^Kenfri Cosmetics: Hi Mama, your account balance of KES 12,500 is 14 days overdue/);
  assert.ok(t.length <= 160 * 2, "fits in two SMS parts");
});
