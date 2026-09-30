import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, brands, categories, offerTargets, offers, products, saleLines, sales } from "@/db";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { EmptyState, Money, PageHeader, Pill } from "@/components/ui";
import { OfferForm } from "./offer-form";
import { PauseButton } from "./pause-button";
import { PosterMaker } from "./poster-maker";
import { magnificEnabled } from "@/lib/magnific";

export const maxDuration = 60;

export const dynamic = "force-dynamic";

function describe(o: typeof offers.$inferSelect): string {
  switch (o.type) {
    case "percent_off": return `${o.value / 100}% off`;
    case "amount_off": return `KES ${(o.value / 100).toLocaleString("en-KE")} off each`;
    case "fixed_price": return `Now KES ${(o.value / 100).toLocaleString("en-KE")}`;
    case "bonus_points": return `+${(o.value / 100).toLocaleString("en-KE")} points${o.minSpendCents ? ` on KES ${(o.minSpendCents / 100).toLocaleString("en-KE")}+` : ""}`;
    case "points_multiplier": return `${o.value / 100}× points`;
    default: return o.type;
  }
}

export default async function OffersPage() {
  const s = await requirePage("catalog.view");
  const orgId = s.org.id;
  const [rows, brandRows, catRows, productRows] = await Promise.all([
    db.select().from(offers).where(eq(offers.orgId, orgId)).orderBy(desc(offers.endsAt)).limit(100),
    db.select({ id: brands.id, name: brands.name }).from(brands).where(and(eq(brands.orgId, orgId), eq(brands.archived, false))).orderBy(asc(brands.name)),
    db.select({ id: categories.id, name: categories.name, parentId: categories.parentId }).from(categories).where(and(eq(categories.orgId, orgId), eq(categories.archived, false))).orderBy(asc(categories.sortOrder)),
    db.select({ id: products.id, name: products.name }).from(products).where(and(eq(products.orgId, orgId), eq(products.archived, false))).orderBy(asc(products.name)),
  ]);
  const ids = rows.map((r) => r.id);
  const [targets, perf] = ids.length
    ? await Promise.all([
        db.select().from(offerTargets).where(inArray(offerTargets.offerId, ids)),
        db
          .select({ offerId: saleLines.offerId, units: sql<number>`sum(${saleLines.qty})::int`, discount: sql<string>`sum(${saleLines.promoDiscountCents})`, revenue: sql<string>`sum(${saleLines.lineTotalCents})` })
          .from(saleLines)
          .innerJoin(sales, eq(sales.id, saleLines.saleId))
          .where(and(eq(saleLines.orgId, orgId), inArray(saleLines.offerId, ids)))
          .groupBy(saleLines.offerId),
      ])
    : [[], []];
  const now = new Date();
  const nameOf = (kind: string, id: number) =>
    kind === "brand" ? brandRows.find((b) => b.id === id)?.name : kind === "category" ? catRows.find((c) => c.id === id)?.name : productRows.find((p) => p.id === id)?.name;
  const catParents = catRows.filter((c) => c.parentId === null);
  const catOptions = catParents.flatMap((p) => [{ id: p.id, name: p.name }, ...catRows.filter((c) => c.parentId === p.id).map((c) => ({ id: c.id, name: `${p.name} › ${c.name}` }))]);

  return (
    <>
      <PageHeader title="Offers" subtitle="Schedule promotions. The till applies them automatically while they're live — with none, normal prices apply." />
      <div className="grid gap-5 lg:grid-cols-[1fr_380px] items-start">
        <div className="grid gap-3">
          {rows.length === 0 ? (
            <EmptyState title="No offers yet" body="Create one on the right — e.g. 20% off a brand this weekend, or bonus points on hair care." />
          ) : rows.map((o) => {
            const status = !o.active ? { label: "Paused", tone: "neutral" as const } : now < o.startsAt ? { label: "Scheduled", tone: "warn" as const } : now >= o.endsAt ? { label: "Ended", tone: "neutral" as const } : { label: "Live", tone: "good" as const };
            const t = targets.filter((x) => x.offerId === o.id);
            const p = perf.find((x) => x.offerId === o.id);
            return (
              <div key={o.id} className="card p-4 grid gap-1.5">
                <div className="flex justify-between gap-3 items-start">
                  <div>
                    <div className="font-semibold text-[14.5px]">{o.title}</div>
                    <div className="text-[13px] text-brand-700">{describe(o)}{o.audience !== "all" ? ` · ${o.audience} customers only` : ""}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Pill tone={status.tone}>{status.label}</Pill>
                    {can(s.role, "catalog.set_prices") && now < o.endsAt && <PauseButton offerId={o.id} active={o.active} />}
                    {can(s.role, "catalog.edit") && now < o.endsAt && <PosterMaker offerId={o.id} offerTitle={o.title} magnific={magnificEnabled()} />}
                  </div>
                </div>
                <div className="text-[12.5px] text-ink-600">
                  {t.length === 0 ? "Everything in the shop" : t.map((x) => nameOf(x.kind, x.targetId) ?? "—").join(", ")}
                </div>
                <div className="text-[12px] text-ink-400">
                  {o.startsAt.toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" })} → {o.endsAt.toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" })}
                </div>
                {p && (
                  <div className="text-[12.5px] text-ink-600 flex gap-4 flex-wrap">
                    <span className="tnum">{p.units} sold</span>
                    <span>Revenue <Money cents={Number(p.revenue)} /></span>
                    <span>Discount given <Money cents={Number(p.discount)} /></span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {can(s.role, "catalog.set_prices") && <OfferForm brands={brandRows} categories={catOptions} products={productRows} />}
      </div>
    </>
  );
}
