/** Credit reminder rules — pure, no database. */

/** When a reminder goes out, relative to the oldest unpaid purchase's due date. */
export type ReminderStage = "before" | "due" | "overdue";

/** Pure: which reminder (if any) is due today. Before: 3 days ahead; due day; then weekly for 8 weeks. */
export function reminderStage(dueDate: string, today: string): { stage: ReminderStage; daysLate: number } | null {
  const days = Math.round((Date.parse(today) - Date.parse(dueDate)) / 86_400_000);
  if (days === -3) return { stage: "before", daysLate: 0 };
  if (days === 0) return { stage: "due", daysLate: 0 };
  if (days > 0 && days % 7 === 0 && days <= 56) return { stage: "overdue", daysLate: days };
  return null;
}

/** Pure: the oldest purchase not yet covered by payments (payments clear the oldest first). */
export function oldestUnpaid(lines: { date: string; chargeCents: number; paymentCents: number }[], openingCents: number): { date: string; owedCents: number } | null {
  // Payments first cover any opening balance, then purchases oldest-first.
  let paidPool = lines.reduce((s, l) => s + l.paymentCents, 0) - Math.max(0, openingCents);
  if (paidPool < 0 && openingCents > 0) return { date: lines[0]?.date ?? "1900-01-01", owedCents: openingCents + lines.reduce((s, l) => s + l.chargeCents - l.paymentCents, 0) };
  const charges = lines.filter((l) => l.chargeCents > 0);
  const owed = openingCents + lines.reduce((s, l) => s + l.chargeCents - l.paymentCents, 0);
  if (owed <= 0) return null;
  for (const c of charges) {
    if (paidPool >= c.chargeCents) { paidPool -= c.chargeCents; continue; }
    return { date: c.date, owedCents: owed };
  }
  return null;
}

const kes = (c: number) => `KES ${(c / 100).toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export function reminderText(p: { shop: string; name: string | null; owedCents: number; dueDate: string; stage: ReminderStage; daysLate: number }): string {
  const hi = p.name ? `Hi ${p.name.split(" ")[0]}, ` : "";
  const due = new Date(`${p.dueDate}T12:00:00+03:00`).toLocaleDateString("en-KE", { day: "numeric", month: "short" });
  if (p.stage === "before") return `${p.shop}: ${hi}a friendly reminder that your account balance of ${kes(p.owedCents)} is due on ${due}. Thank you for shopping with us.`;
  if (p.stage === "due") return `${p.shop}: ${hi}your account balance of ${kes(p.owedCents)} is due today. You can pay at the shop or by M-Pesa. Thank you!`;
  return `${p.shop}: ${hi}your account balance of ${kes(p.owedCents)} is ${p.daysLate} days overdue (due ${due}). Please pay at the shop or by M-Pesa, or call us if you need time.`;
}

