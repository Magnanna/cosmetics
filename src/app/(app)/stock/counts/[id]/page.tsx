import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db, products, stockTakeLines, stockTakes, variants } from "@/db";
import { inOrg, requirePage } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { variantPicklist } from "@/lib/picklist";
import { reviewStockTake } from "@/lib/stocktake";
import { PageHeader } from "@/components/ui";
import { CountScreen } from "./count-screen";
import { ReviewScreen } from "./review-screen";

export const dynamic = "force-dynamic";

export default async function StockTakePage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePage("stock.count");
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const [take] = await db.select().from(stockTakes).where(and(eq(stockTakes.orgId, s.org.id), eq(stockTakes.id, id))).limit(1);
  if (!take) notFound();

  const subtitle = `${take.scopeLabel} · started ${take.createdAt.toLocaleString("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium", timeStyle: "short" })}`;

  if (take.status === "counting") {
    const [lines, picklist] = await Promise.all([
      db
        .select({ variantId: stockTakeLines.variantId, counted: stockTakeLines.countedQty, product: products.name, o1: variants.option1Value, o2: variants.option2Value })
        .from(stockTakeLines)
        .innerJoin(variants, eq(variants.id, stockTakeLines.variantId))
        .innerJoin(products, eq(products.id, variants.productId))
        .where(eq(stockTakeLines.stockTakeId, take.id))
        .orderBy(asc(products.name), asc(variants.id)),
      variantPicklist(s.org.id),
    ]);
    return (
      <>
        <PageHeader title="Count the shelves" subtitle={subtitle} />
        <CountScreen
          stockTakeId={take.id}
          canCancel={can(s.role, "stock.approve")}
          lines={lines.map((l) => ({ variantId: l.variantId, name: [l.product, l.o1, l.o2].filter(Boolean).join(" · "), counted: l.counted }))}
          picklist={picklist.map((p) => ({ ...p, onHand: 0 }))}
        />
      </>
    );
  }

  const review = await inOrg(s, () => reviewStockTake(db, take.id));
  return (
    <>
      <PageHeader title={take.status === "submitted" ? "Review stock take" : "Stock take"} subtitle={subtitle} />
      <ReviewScreen stockTakeId={take.id} status={take.status} canApprove={can(s.role, "stock.approve")} lines={review} varianceCostCents={take.varianceCostCents} />
    </>
  );
}
