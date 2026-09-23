/* Applies drizzle/ migrations, then locks every public table behind RLS.
   The app talks to Postgres directly (server-side only), so the Supabase
   REST/anon API must see nothing: RLS on with no policies = deny all. */
import { loadEnv } from "./env";
loadEnv();

async function main() {
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  const { db } = await import("../src/db");
  const { sql } = await import("drizzle-orm");

  await migrate(db, { migrationsFolder: "drizzle" });
  console.log("✓ migrations applied");

  const tables = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`
  );
  for (const { tablename } of tables) {
    await db.execute(sql.raw(`alter table public."${tablename}" enable row level security`));
  }
  console.log(`✓ RLS enabled (deny-all to anon/authenticated) on ${tables.length} tables`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
