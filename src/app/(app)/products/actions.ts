"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, brands, categories, products, variantBarcodes, variants } from "@/db";
import { audit, ForbiddenError, withSession } from "@/lib/auth";
import { nextInStoreBarcode } from "@/lib/catalog";
import { can } from "@/lib/permissions";
import { postOpeningStock } from "@/lib/stock-postings";
import { nairobiDate } from "@/lib/time";

const cents = z.number().int().min(0).max(100_000_000);

const VariantInput = z.object({
  option1Value: z.string().trim().max(60).nullable(),
  option2Value: z.string().trim().max(60).nullable(),
  barcode: z.string().trim().max(32).nullable(),
  generateBarcode: z.boolean(),
  retailPriceCents: cents,
  wholesalePriceCents: cents,
  reorderLevel: z.number().int().min(0).max(100_000),
  swatchHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable(),
  openingQty: z.number().int().min(0).max(1_000_000),
  openingUnitCostCents: cents,
});

const ProductInput = z.object({
  name: z.string().trim().min(2, "Give the product a name.").max(120),
  brandId: z.number().int().nullable(),
  newBrandName: z.string().trim().max(60).nullable(),
  categoryId: z.number().int().nullable(),
  option1Name: z.string().trim().max(30).nullable(),
  option2Name: z.string().trim().max(30).nullable(),
  variants: z.array(VariantInput).min(1).max(200),
});

export type ProductInput = z.infer<typeof ProductInput>;

export async function createProduct(raw: ProductInput): Promise<{ error?: string; productId?: number }> {
  const parsed = ProductInput.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const input = parsed.data;

  if (input.option2Name && !input.option1Name) return { error: "Fill in the first option before the second." };
  if (input.option1Name && input.variants.some((v) => !v.option1Value)) return { error: `Every variant needs a ${input.option1Name}.` };
  if (input.option2Name && input.variants.some((v) => !v.option2Value)) return { error: `Every variant needs a ${input.option2Name}.` };
  const combos = new Set(input.variants.map((v) => `${v.option1Value ?? ""}|${v.option2Value ?? ""}`));
  if (combos.size !== input.variants.length) return { error: "Two variants have the same options." };
  const typed = input.variants.map((v) => v.barcode).filter(Boolean) as string[];
  if (new Set(typed).size !== typed.length) return { error: "The same barcode is on two variants." };

  try {
    return await withSession("catalog.edit", async (s) => {
      // Prices on new products apply immediately for owner and staff (owner decision, 30 Sep 2026).
      const canStock = can(s.role, "stock.receive");
      const date = nairobiDate();

      return db.transaction(async (tx) => {
        if (typed.length) {
          const taken = await tx
            .select({ code: variantBarcodes.code })
            .from(variantBarcodes)
            .where(and(eq(variantBarcodes.orgId, s.org.id), inArray(variantBarcodes.code, typed)));
          if (taken.length) throw new UserError(`Barcode ${taken[0].code} is already on another product.`);
        }

        let brandId = input.brandId;
        if (!brandId && input.newBrandName) {
          const [b] = await tx
            .insert(brands)
            .values({ orgId: s.org.id, name: input.newBrandName })
            .onConflictDoUpdate({ target: [brands.orgId, brands.name], set: { archived: false } })
            .returning({ id: brands.id });
          brandId = b.id;
        }
        if (input.categoryId) {
          const [c] = await tx.select({ id: categories.id }).from(categories).where(and(eq(categories.orgId, s.org.id), eq(categories.id, input.categoryId))).limit(1);
          if (!c) throw new UserError("That category no longer exists.");
        }

        const [product] = await tx
          .insert(products)
          .values({
            orgId: s.org.id,
            name: input.name,
            brandId,
            categoryId: input.categoryId,
            option1Name: input.option1Name || null,
            option2Name: input.option2Name || null,
          })
          .returning({ id: products.id });

        for (const v of input.variants) {
          const [row] = await tx
            .insert(variants)
            .values({
              orgId: s.org.id,
              productId: product.id,
              option1Value: input.option1Name ? v.option1Value : null,
              option2Value: input.option2Name ? v.option2Value : null,
              retailPriceCents: v.retailPriceCents,
              wholesalePriceCents: v.wholesalePriceCents,
              reorderLevel: v.reorderLevel,
              swatchHex: v.swatchHex,
            })
            .returning({ id: variants.id });

          const code = v.barcode || (v.generateBarcode ? await nextInStoreBarcode(tx) : null);
          if (code) {
            await tx.insert(variantBarcodes).values({ orgId: s.org.id, variantId: row.id, code, source: v.barcode ? "manufacturer" : "generated" });
          }

          if (v.openingQty > 0) {
            if (!canStock) throw new UserError("You can't add opening stock.");
            await postOpeningStock(tx, { variantId: row.id, qty: v.openingQty, totalCostCents: v.openingQty * v.openingUnitCostCents, date });
          }
        }

        await audit(tx, { action: "product.create", entity: "product", entityId: product.id, after: input });
        return { productId: product.id };
      });
    }).finally(() => revalidatePath("/products"));
  } catch (e) {
    if (e instanceof UserError || e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
}

class UserError extends Error {}
