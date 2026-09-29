import { eq } from "drizzle-orm";
import { db, customers, members, orgs, salePayments, saleLines, sales } from "@/db";
import { maskPhone } from "./phone";

export interface ReceiptData {
  shop: { name: string; address: string | null; phone: string | null; kraPin: string | null; footer: string | null };
  receiptNo: string;
  token: string;
  createdAt: string; // ISO
  cashier: string;
  customer: { name: string | null; phoneMasked: string; pointsBalance: number | null };
  lines: { description: string; qty: number; unitCents: number; totalCents: number; discountCents: number }[];
  grossCents: number;
  discountCents: number;
  totalCents: number;
  payments: { method: string; amountCents: number; tenderedCents: number | null; changeCents: number | null; mpesaCode: string | null }[];
  pointsEarned: number;
}

/** Everything needed to print or show a receipt. The token is the credential for public links. */
export async function getReceiptByToken(token: string): Promise<ReceiptData | null> {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  const [row] = await db
    .select({ sale: sales, org: orgs, customer: customers, cashier: members.name })
    .from(sales)
    .innerJoin(orgs, eq(orgs.id, sales.orgId))
    .innerJoin(customers, eq(customers.id, sales.customerId))
    .leftJoin(members, eq(members.id, sales.memberId))
    .where(eq(sales.receiptToken, token))
    .limit(1);
  if (!row) return null;
  const [lines, pays] = await Promise.all([
    db.select().from(saleLines).where(eq(saleLines.saleId, row.sale.id)).orderBy(saleLines.id),
    db.select().from(salePayments).where(eq(salePayments.saleId, row.sale.id)).orderBy(salePayments.id),
  ]);
  const earns = row.customer.earnsPointsOverride ?? row.customer.type === "retail";
  return {
    shop: { name: row.org.name, address: row.org.address, phone: row.org.phone, kraPin: row.org.kraPin, footer: row.org.receiptFooter },
    receiptNo: row.sale.receiptNo,
    token,
    createdAt: row.sale.createdAt.toISOString(),
    cashier: row.cashier || "Staff",
    customer: { name: row.customer.name, phoneMasked: maskPhone(row.customer.phone), pointsBalance: earns ? row.customer.pointsBalance : null },
    lines: lines.map((l) => ({ description: l.description, qty: l.qty, unitCents: l.unitPriceCents, totalCents: l.lineTotalCents, discountCents: l.manualDiscountCents + l.promoDiscountCents })),
    grossCents: row.sale.grossCents,
    discountCents: row.sale.manualDiscountCents + row.sale.promoDiscountCents,
    totalCents: row.sale.totalCents,
    payments: pays.map((p) => ({ method: p.method, amountCents: p.amountCents, tenderedCents: p.tenderedCents, changeCents: p.changeCents, mpesaCode: p.mpesaCode })),
    pointsEarned: row.sale.pointsEarned,
  };
}
