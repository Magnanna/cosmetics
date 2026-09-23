/* Seeds the Kenfri Cosmetics org: chart of accounts, shop location, till,
   categories. Idempotent — safe to re-run.
   Run: npm run db:seed */
import { loadEnv } from "./env";
loadEnv();

async function main() {
  const { db, orgs, accounts, locations, registers, categories } = await import("../src/db");
  const { and, eq, isNull } = await import("drizzle-orm");
  const { SEED_ACCOUNTS, SEED_CATEGORIES } = await import("../src/lib/coa");

  const slug = process.env.SEED_ORG_SLUG ?? "kenfri";
  let [org] = await db.select().from(orgs).where(eq(orgs.slug, slug)).limit(1);
  if (!org) {
    [org] = await db.insert(orgs).values({ name: "Kenfri Cosmetics", slug, receiptFooter: "Returns within 24 hrs, unopened items only. Thank you!" }).returning();
    console.log(`✓ created org ${org.name} (#${org.id})`);
  }

  const existing = new Set(
    (await db.select({ code: accounts.code }).from(accounts).where(eq(accounts.orgId, org.id))).map((a) => a.code)
  );
  const missing = SEED_ACCOUNTS.filter((a) => !existing.has(a.code));
  if (missing.length) {
    await db.insert(accounts).values(
      missing.map((a) => ({ orgId: org.id, code: a.code, name: a.name, type: a.type, subtype: a.subtype, description: a.description, isSystem: !!a.system }))
    );
  }
  console.log(`✓ chart of accounts (${missing.length} added)`);

  let [shop] = await db.select().from(locations).where(and(eq(locations.orgId, org.id), eq(locations.isDefault, true))).limit(1);
  if (!shop) [shop] = await db.insert(locations).values({ orgId: org.id, name: "Shop", kind: "shop", isDefault: true }).returning();
  const [till] = await db.select().from(registers).where(eq(registers.orgId, org.id)).limit(1);
  if (!till) await db.insert(registers).values({ orgId: org.id, locationId: shop.id, name: "Till 1" });
  console.log("✓ shop location and till");

  let added = 0;
  for (const [i, c] of SEED_CATEGORIES.entries()) {
    let [parent] = await db.select().from(categories).where(and(eq(categories.orgId, org.id), isNull(categories.parentId), eq(categories.name, c.name))).limit(1);
    if (!parent) {
      [parent] = await db.insert(categories).values({ orgId: org.id, name: c.name, sortOrder: i }).returning();
      added++;
    }
    for (const [j, child] of (c.children ?? []).entries()) {
      const [row] = await db.select().from(categories).where(and(eq(categories.orgId, org.id), eq(categories.parentId, parent.id), eq(categories.name, child))).limit(1);
      if (!row) {
        await db.insert(categories).values({ orgId: org.id, parentId: parent.id, name: child, sortOrder: j });
        added++;
      }
    }
  }
  console.log(`✓ categories (${added} added)`);
  console.log(`\nOrg id: ${org.id}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
