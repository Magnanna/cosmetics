import { test, after } from "node:test";
import assert from "node:assert/strict";
import { loadEnv } from "../../scripts/env";
loadEnv();

const { db, orgs, suppliers, products, variants, bills } = await import("../../src/db");
const { eq } = await import("drizzle-orm");
const { runWithOrg } = await import("../../src/lib/context");
const r = await import("../../src/lib/receiving");
const { onHand } = await import("../../src/lib/inventory");
const { isValidEan13 } = await import("../../src/lib/barcode");

const [org] = await db.select().from(orgs).where(eq(orgs.slug, "kenfri")).limit(1);
const asStaff = <T>(fn: () => Promise<T>) => runWithOrg({ orgId: org.id, memberId: 999_003, role: "staff" }, fn);

class Rollback extends Error {}
async function inRollback(fn: (tx: any) => Promise<void>) {
  await assert.rejects(db.transaction(async (tx) => { await fn(tx); throw new Rollback(); }), Rollback);
}

test("scan a delivery: new items, repeat scans, new shade, no-barcode item, post as bill", () =>
  asStaff(() => inRollback(async (tx) => {
    const [sup] = await tx.insert(suppliers).values({ orgId: org.id, name: "TEST Distributor" }).returning();
    const id = await r.startReceiving(tx, { supplierId: sup.id, supplierInvoiceNo: "INV-TEST-9", invoiceDate: "2026-09-30", dueDate: "2026-10-30", ratesIncludeVat: true });

    // Unknown barcode → staff create it with prices (apply immediately), then 11 more scans
    assert.equal(await r.variantByBarcode(tx, "6161100000017"), null);
    const foundation = await r.createItemFromScan(tx, { barcode: "6161100000017", name: "TEST Foundation 30ml", brandName: "TEST Glow", categoryId: null, attachToProductId: null, optionValue: null, swatchHex: null, retailPriceCents: 120_000, wholesalePriceCents: 100_000 });
    for (let i = 0; i < 12; i++) await r.addToReceiving(tx, id, foundation.variantId);
    const [v] = await tx.select().from(variants).where(eq(variants.id, foundation.variantId));
    assert.equal(v.retailPriceCents, 120_000);

    // Second shade of the same foundation, its own barcode → grouped under one product
    const honey = await r.createItemFromScan(tx, { barcode: "6161100000024", name: "", brandName: null, categoryId: null, attachToProductId: foundation.productId, optionValue: "Honey", swatchHex: "#c89b7b", retailPriceCents: 120_000, wholesalePriceCents: 100_000 });
    assert.equal(honey.productId, foundation.productId);
    const [prod] = await tx.select().from(products).where(eq(products.id, foundation.productId));
    assert.equal(prod.option1Name, "Shade");
    await r.addToReceiving(tx, id, honey.variantId, 6);
    await assert.rejects(r.createItemFromScan(tx, { barcode: "6161100000031", name: "", brandName: null, categoryId: null, attachToProductId: foundation.productId, optionValue: "Honey", swatchHex: null, retailPriceCents: 1, wholesalePriceCents: 0 }), /already exists/);
    await assert.rejects(r.createItemFromScan(tx, { barcode: "6161100000017", name: "Dup", brandName: null, categoryId: null, attachToProductId: null, optionValue: null, swatchHex: null, retailPriceCents: 1, wholesalePriceCents: 0 }), /already on a product/);

    // No barcode on the pack → in-store EAN-13 generated
    const comb = await r.createItemFromScan(tx, { barcode: null, name: "TEST Wide-tooth comb", brandName: null, categoryId: null, attachToProductId: null, optionValue: null, swatchHex: null, retailPriceCents: 5_000, wholesalePriceCents: 4_000 });
    assert.ok(isValidEan13(comb.barcode) && comb.barcode.startsWith("2"));
    await r.addToReceiving(tx, id, comb.variantId, 24);

    // Can't post until every line has a cost
    await assert.rejects(r.postReceiving(tx, id), /no cost yet/);
    await r.updateReceivingLine(tx, id, foundation.variantId, { unitRateCents: 65_000 });
    await r.updateReceivingLine(tx, id, honey.variantId, { unitRateCents: 65_000 });
    await r.updateReceivingLine(tx, id, comb.variantId, { unitRateCents: 1_500, qty: 20 });

    const bill = await r.postReceiving(tx, id);
    assert.equal(bill.totalCents, 12 * 65_000 + 6 * 65_000 + 20 * 1_500);
    const [b] = await tx.select().from(bills).where(eq(bills.id, bill.billId));
    assert.equal(b.supplierInvoiceNo, "INV-TEST-9");
    assert.deepEqual(await onHand(tx, foundation.variantId), { qty: 12, valueCents: 12 * 65_000 });
    assert.deepEqual(await onHand(tx, comb.variantId), { qty: 20, valueCents: 20 * 1_500 });
    await assert.rejects(r.addToReceiving(tx, id, comb.variantId), /already saved/);
  })));

after(async () => { await db.$client.end(); });
