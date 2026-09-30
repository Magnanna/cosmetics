import { and, asc, eq, sql } from "drizzle-orm";
import { db, accounts, brands, categories, products, registers, stockLots, variantBarcodes, variants } from "@/db";
import { inOrg, requirePage } from "@/lib/auth";
import { openShiftFor } from "@/lib/shifts";
import { loadOffers } from "@/lib/offers-db";
import { TillApp, type TillProduct } from "./till-app";
import { BrandStyle } from "@/components/brand-style";

export const dynamic = "force-dynamic";

export default async function TillPage() {
  const s = await requirePage("till.sell");
  const orgId = s.org.id;

  const [register] = await db.select().from(registers).where(eq(registers.orgId, orgId)).orderBy(asc(registers.id)).limit(1);
  const shift = register ? await inOrg(s, () => openShiftFor(db, register.id)) : null;

  const [rows, codes, stock, cats, offerDefs, expenseAccounts] = await Promise.all([
    db
      .select({
        variantId: variants.id,
        productId: products.id,
        productName: products.name,
        imageUrl: products.imageUrl,
        brand: brands.name,
        brandId: products.brandId,
        categoryId: products.categoryId,
        option1Name: products.option1Name,
        option2Name: products.option2Name,
        option1Value: variants.option1Value,
        option2Value: variants.option2Value,
        retail: variants.retailPriceCents,
        wholesale: variants.wholesalePriceCents,
        swatchHex: variants.swatchHex,
      })
      .from(variants)
      .innerJoin(products, eq(products.id, variants.productId))
      .leftJoin(brands, eq(brands.id, products.brandId))
      .where(and(eq(variants.orgId, orgId), eq(variants.archived, false), eq(products.archived, false)))
      .orderBy(asc(products.name), asc(variants.id)),
    db.select({ variantId: variantBarcodes.variantId, code: variantBarcodes.code }).from(variantBarcodes).where(eq(variantBarcodes.orgId, orgId)),
    db
      .select({ variantId: stockLots.variantId, qty: sql<string>`sum(${stockLots.remainingQty})` })
      .from(stockLots)
      .where(eq(stockLots.orgId, orgId))
      .groupBy(stockLots.variantId),
    db.select({ id: categories.id, parentId: categories.parentId, name: categories.name }).from(categories).where(and(eq(categories.orgId, orgId), eq(categories.archived, false))).orderBy(asc(categories.sortOrder)),
    loadOffers(db, orgId),
    db.select({ code: accounts.code, name: accounts.name }).from(accounts).where(and(eq(accounts.orgId, orgId), eq(accounts.type, "expense"), eq(accounts.archived, false), sql`${accounts.code} >= '6000'`)).orderBy(asc(accounts.code)),
  ]);

  const barcodes = new Map<number, string[]>();
  for (const c of codes) barcodes.set(c.variantId, [...(barcodes.get(c.variantId) ?? []), c.code]);
  const onHand = new Map(stock.map((r) => [r.variantId, Number(r.qty)]));
  const topOf = new Map<number, number>();
  for (const c of cats) topOf.set(c.id, c.parentId ?? c.id);

  const byProduct = new Map<number, TillProduct>();
  for (const r of rows) {
    let p = byProduct.get(r.productId);
    if (!p) {
      p = {
        id: r.productId,
        name: r.productName,
        brand: r.brand,
        brandId: r.brandId,
        imageUrl: r.imageUrl,
        topCategoryId: r.categoryId ? topOf.get(r.categoryId) ?? null : null,
        categoryIds: r.categoryId ? [...new Set([r.categoryId, topOf.get(r.categoryId) ?? r.categoryId])] : [],
        optionNames: [r.option1Name, r.option2Name].filter(Boolean) as string[],
        variants: [],
      };
      byProduct.set(r.productId, p);
    }
    p.variants.push({
      id: r.variantId,
      label: [r.option1Value, r.option2Value].filter(Boolean).join(" · "),
      retailCents: r.retail,
      wholesaleCents: r.wholesale,
      swatchHex: r.swatchHex,
      barcodes: barcodes.get(r.variantId) ?? [],
      onHand: onHand.get(r.variantId) ?? 0,
    });
  }

  const topCategories = cats.filter((c) => c.parentId === null).map((c) => ({ id: c.id, name: c.name }));

  return (
    <>
    <BrandStyle color={s.org.brandColor} />
    <TillApp
      shopName={s.org.name}
      logoUrl={s.org.logoUrl}
      cashierName={s.member.name || s.email}
      role={s.role}
      registerId={register?.id ?? null}
      registerName={register?.name ?? "Till"}
      shiftOpen={!!shift}
      discountLimitCents={s.org.cashierDiscountLimitCents}
      products={[...byProduct.values()]}
      categories={topCategories}
      offers={offerDefs}
      expenseAccounts={expenseAccounts}
    />
    </>
  );
}
