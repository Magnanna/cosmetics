"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, suppliers } from "@/db";
import { audit, ForbiddenError, withSession } from "@/lib/auth";
import { normalizeKenyanPhone } from "@/lib/phone";

const SupplierInput = z.object({
  name: z.string().trim().min(2, "Enter the supplier's name.").max(120),
  kraPin: z.string().trim().max(20).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().email("That email doesn't look right.").or(z.literal("")).optional(),
  paymentDetails: z.string().trim().max(300).optional(),
  termsDays: z.coerce.number().int().min(0).max(365),
});

export async function createSupplier(_: unknown, form: FormData): Promise<{ error?: string; ok?: boolean }> {
  const parsed = SupplierInput.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const v = parsed.data;
  const phone = v.phone ? normalizeKenyanPhone(v.phone) ?? v.phone : null; // landlines are fine for suppliers
  try {
    await withSession("suppliers.edit", (s) =>
      db.transaction(async (tx) => {
        const [row] = await tx
          .insert(suppliers)
          .values({ orgId: s.org.id, name: v.name, kraPin: v.kraPin?.toUpperCase() || null, phone, email: v.email || null, paymentDetails: v.paymentDetails || null, termsDays: v.termsDays })
          .returning();
        await audit(tx, { action: "supplier.create", entity: "supplier", entityId: row.id, after: row });
      })
    );
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
  revalidatePath("/suppliers");
  return { ok: true };
}
