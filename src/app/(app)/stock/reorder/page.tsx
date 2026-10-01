import Link from "next/link";
import { and, eq, gte, ne, sql } from "drizzle-orm";
import { db, products, saleLines, sales, stockLots, suppliers, variantSuppliers, variants } from "@/db";
import { requirePage } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { nairobiDate } from "@/lib/time";
import { suggestReorder, VELOCITY_DAYS } from "@/lib/reorder";
import { EmptyState, PageHeader } from "@/components/ui";
import { ReorderBoard, type ReorderGroup } from "./board";

export const dynamic = "force-dynamic";

export default async function ReorderPage() {
  const s = await requirePage("stock.receive");
  const orgId = s.org.id;
  const since = new Date(Date.now() - VELOCITY_DAYS * 86_400_000);
  const sinceDate = nairobiDate(since);

  const [items, sold, onHand, links, sups] = await Promise.all([
    db.select({ id: variants.id, reorderLevel: variants.reorderLevel, o1: variants.option1Value, o2: variants.option2Value, name: products.name })
      .from(variants).innerJoin(products, eq(products.id, variants.productId))
      .where(and(eq(variants.orgId, orgId), eq(variants.archived, false), eq(products.archived, false))),
    db.select({ variantId: saleLines.variantId, units: sql<number>`sum(${saleLines.qty})::int` })
      .from(saleLines).innerJoin(sales, eq(sales.id, saleLines.saleId))
      .where(and(eq(sales.orgId, orgId), gte(sales.businessDate, sinceDate), ne(sales.status, "returned")))
      .groupBy(saleLines.variantId),
    db.select({ variantId: stockLots.variantId, qty: sql<number>`sum(${stockLots.remainingQty})::int` })
      .from(stockLots).where(eq(stockLots.orgId, orgId)).groupBy(stockLots.variantId),
    // Most recently linked supplier per variant is treated as the usual one.
    db.selectDistinctOn([variantSuppliers.variantId], { variantId: variantSuppliers.variantId, supplierId: variantSuppliers.supplierId, code: variantSuppliers.supplierItemCode, uom: variantSuppliers.purchaseUom, perUom: variantSuppliers.unitsPerUom, cost: variantSuppliers.lastCostCents })
      .from(variantSuppliers).where(eq(variantSuppliers.orgId, orgId)).orderBy(variantSuppliers.variantId, sql`${variantSuppliers.id} desc`),
    db.select().from(suppliers).where(and(eq(suppliers.orgId, orgId), eq(suppliers.archived, false))),
  ]);
  const soldBy = new Map(sold.map((r) => [r.variantId, r.units]));
  const stockBy = new Map(onHand.map((r) => [r.variantId, r.qty]));
  const linkBy = new Map(links.map((r) => [r.variantId, r]));
  const supBy = new Map(sups.map((x) => [x.id, x]));

  const groups = new Map<number, ReorderGroup>();
  for (const v of items) {
    const link = linkBy.get(v.id);
    const sup = link ? supBy.get(link.supplierId) : undefined;
    const sug = suggestReorder({
      soldUnits: soldBy.get(v.id) ?? 0,
      onHand: stockBy.get(v.id) ?? 0,
      leadDays: sup?.leadTimeDays ?? 7,
      coverDays: s.org.reorderCoverDays,
      unitsPerPack: link?.perUom ?? 1,
      reorderLevel: v.reorderLevel,
    });
    if (!sug) continue;
    const key = sup?.id ?? 0;
    if (!groups.has(key)) groups.set(key, { supplierId: sup?.id ?? null, supplierName: sup?.name ?? "No supplier yet", phone: sup?.phone ?? null, leadDays: sup?.leadTimeDays ?? 7, lines: [] });
    groups.get(key)!.lines.push({
      variantId: v.id,
      name: [v.name, v.o1, v.o2].filter(Boolean).join(" · "),
      code: link?.code ?? null,
      uom: link?.uom ?? "PCS",
      perPack: link?.perUom ?? 1,
      onHand: stockBy.get(v.id) ?? 0,
      perWeek: Math.round(sug.perDay * 7 * 10) / 10,
      daysLeft: sug.daysLeft === null ? null : Math.floor(sug.daysLeft),
      packs: sug.packs,
      urgent: sug.urgent,
      unitCostCents: link?.cost ?? null,
    });
  }
  const list = [...groups.values()].sort((a, b) => (a.supplierId === null ? 1 : b.supplierId === null ? -1 : a.supplierName.localeCompare(b.supplierName)));
  for (const g of list) g.lines.sort((a, b) => Number(b.urgent) - Number(a.urgent) || (a.daysLeft ?? 9e9) - (b.daysLeft ?? 9e9));

  return (
    <>
      <PageHeader
        title="Reorder list"
        subtitle={<>Based on the last 8 weeks of sales, each supplier's delivery time, and {s.org.reorderCoverDays} days of stock after delivery. <Link href="/suppliers" className="underline">Set delivery times</Link></>}
      />
      {list.length === 0 ? (
        <EmptyState title="Nothing to reorder" body="Every item has enough stock to last until a new delivery would arrive. Items show up here as they sell down or drop under their reorder level." />
      ) : (
        <ReorderBoard groups={list} canSms={can(s.role, "stock.receive")} shopName={s.org.name} shopPhone={s.org.phone} />
      )}
    </>
  );
}
