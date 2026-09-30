import { test, after } from "node:test";
import assert from "node:assert/strict";
import { loadEnv } from "../../scripts/env";
loadEnv();

const { db, orgs, products, variants, priceChangeRequests } = await import("../../src/db");
const { eq, and } = await import("drizzle-orm");
const { runWithOrg } = await import("../../src/lib/context");
const cat = await import("../../src/lib/catalog");
const { isValidEan13 } = await import("../../src/lib/barcode");

const [org] = await db.select().from(orgs).where(eq(orgs.slug, "kenfri")).limit(1);
const as = <T>(role: "owner" | "staff", fn: () => Promise<T>) => runWithOrg({ orgId: org.id, memberId: 999_006, role }, fn);
class Rollback extends Error {}
async function inRollback(fn: (tx: any) => Promise<void>) {
  await assert.rejects(db.transaction(async (tx) => { await fn(tx); throw new Rollback(); }), Rollback);
}

test("editing: owner prices apply, staff prices wait, barcodes, variants, archive", () =>
  inRollback(async (tx) => {
    const [p] = await tx.insert(products).values({ orgId: org.id, name: "TEST Lip gloss" }).returning();
    const [v] = await tx.insert(variants).values({ orgId: org.id, productId: p.id, retailPriceCents: 50_000, wholesalePriceCents: 40_000 }).returning();

    assert.equal(await as("owner", () => cat.changePrices(tx, { variantId: v.id, retailPriceCents: 55_000, wholesalePriceCents: 40_000 })), "applied");
    assert.equal((await tx.select().from(variants).where(eq(variants.id, v.id)))[0].retailPriceCents, 55_000);

    assert.equal(await as("staff", () => cat.changePrices(tx, { variantId: v.id, retailPriceCents: 60_000, wholesalePriceCents: 45_000, reason: "Supplier price up" })), "requested");
    assert.equal((await tx.select().from(variants).where(eq(variants.id, v.id)))[0].retailPriceCents, 55_000, "staff change not applied yet");
    const reqs = await tx.select().from(priceChangeRequests).where(and(eq(priceChangeRequests.variantId, v.id), eq(priceChangeRequests.status, "pending")));
    assert.equal(reqs.length, 2);
    await assert.rejects(as("staff", () => cat.decidePriceRequest(tx, reqs[0].id, true)), /Only the owner/);
    for (const r of reqs) await as("owner", () => cat.decidePriceRequest(tx, r.id, r.field === "retail"));
    const [after1] = await tx.select().from(variants).where(eq(variants.id, v.id));
    assert.deepEqual([after1.retailPriceCents, after1.wholesalePriceCents], [60_000, 40_000]);

    await as("staff", async () => {
      const gen = await cat.addBarcode(tx, { variantId: v.id, code: null });
      assert.ok(isValidEan13(gen));
      await cat.addBarcode(tx, { variantId: v.id, code: "6161100009999" });
      await assert.rejects(cat.addBarcode(tx, { variantId: v.id, code: "6161100009999" }), /already on this item/);
      await assert.rejects(cat.addVariant(tx, { productId: p.id, option1Value: "Berry", option2Value: null, retailPriceCents: 60_000, wholesalePriceCents: 0, barcode: null }), /Name the option first/);
      await cat.updateProduct(tx, { productId: p.id, name: "TEST Lip gloss", brandName: "TEST Glow", categoryId: null, option1Name: "Shade", option2Name: null, archived: false });
      await cat.updateVariant(tx, { variantId: v.id, option1Value: "Clear", option2Value: null, reorderLevel: 3, swatchHex: "#ffffff", archived: false });
      const berry = await cat.addVariant(tx, { productId: p.id, option1Value: "Berry", option2Value: null, retailPriceCents: 60_000, wholesalePriceCents: 0, barcode: null });
      await assert.rejects(cat.updateVariant(tx, { variantId: berry, option1Value: "Clear", option2Value: null, reorderLevel: 0, swatchHex: null, archived: false }), /already has those options/);
      await cat.updateVariant(tx, { variantId: berry, option1Value: "Berry", option2Value: null, reorderLevel: 0, swatchHex: null, archived: true });
      const [b] = await tx.select().from(variants).where(eq(variants.id, berry));
      assert.equal(b.archived, true);
    });
  }));

after(async () => { await db.$client.end(); });
