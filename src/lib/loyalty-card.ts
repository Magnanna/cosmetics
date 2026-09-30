import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { toSVG } from "bwip-js/node";
import { db, customers, offers, orgs, sales } from "@/db";
import { cardNumber, formatCardNumber } from "./card";
import { earnsPoints } from "./customers";
import { maskPhone } from "./phone";
import { pointsValueCents } from "./loyalty";

/** The customer's card link secret, created the first time it's needed. */
export async function ensureCardToken(customerId: number): Promise<string> {
  const [c] = await db.select({ t: customers.cardToken }).from(customers).where(eq(customers.id, customerId)).limit(1);
  if (c?.t) return c.t;
  const token = randomBytes(18).toString("base64url");
  await db.update(customers).set({ cardToken: token }).where(and(eq(customers.id, customerId), isNull(customers.cardToken)));
  const [again] = await db.select({ t: customers.cardToken }).from(customers).where(eq(customers.id, customerId)).limit(1);
  return again!.t!;
}

/** Card token for the customer on a receipt (only customers who collect points get a card). */
export async function cardTokenForReceipt(receiptToken: string): Promise<string | null> {
  const [row] = await db.select({ c: customers }).from(sales).innerJoin(customers, eq(customers.id, sales.customerId)).where(eq(sales.receiptToken, receiptToken)).limit(1);
  if (!row || !earnsPoints(row.c)) return null;
  return ensureCardToken(row.c.id);
}

export function cardBarcodeSvg(number: string): string {
  return toSVG({ bcid: "code128", text: number, height: 14, scale: 3, includetext: false, paddingwidth: 0, paddingheight: 0 });
}

export async function getCard(token: string) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  const [row] = await db.select({ c: customers, o: orgs }).from(customers).innerJoin(orgs, eq(orgs.id, customers.orgId)).where(eq(customers.cardToken, token)).limit(1);
  if (!row) return null;
  const { c, o } = row;
  const now = new Date();
  const [recent, live] = await Promise.all([
    db.select({ receiptNo: sales.receiptNo, token: sales.receiptToken, total: sales.totalCents, date: sales.businessDate, points: sales.pointsEarned, status: sales.status })
      .from(sales).where(and(eq(sales.orgId, o.id), eq(sales.customerId, c.id))).orderBy(desc(sales.id)).limit(10),
    db.select({ title: offers.title, description: offers.description, endsAt: offers.endsAt })
      .from(offers)
      .where(and(eq(offers.orgId, o.id), eq(offers.active, true), lte(offers.startsAt, now), gt(offers.endsAt, now), inArray(offers.audience, ["all", c.type])))
      .orderBy(offers.endsAt).limit(6),
  ]);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(sales).where(and(eq(sales.orgId, o.id), eq(sales.customerId, c.id), ne(sales.status, "returned")));
  const number = cardNumber(o.id, c.id);
  const earns = earnsPoints(c);
  return {
    shop: { name: o.name, logoUrl: o.logoUrl, brandColor: o.brandColor, phone: o.phone },
    customer: { name: c.businessName || c.name, phoneMasked: maskPhone(c.phone), since: c.createdAt.toISOString(), visits: n },
    number,
    numberFormatted: formatCardNumber(number),
    barcodeSvg: cardBarcodeSvg(number),
    earns,
    points: c.pointsBalance,
    pointsValueCents: pointsValueCents(c.pointsBalance, { earnCentsPerPoint: o.loyaltyEarnCentsPerPoint, pointValueCents: o.loyaltyPointValueCents, minRedeemCents: o.loyaltyMinRedeemCents }),
    minRedeemCents: o.loyaltyMinRedeemCents,
    earnKes: o.loyaltyEarnCentsPerPoint / 100,
    recent,
    offers: live.map((x) => ({ ...x, endsAt: x.endsAt.toISOString() })),
  };
}
