import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * The app runs through Supabase's transaction pooler (port 6543): session mode
 * (5432) allows only 15 clients in total, which a few serverless instances
 * plus a dev server exhaust. Migrations and backups keep using DATABASE_URL as is.
 */
export function runtimeDatabaseUrl(url: string): string {
  const u = new URL(url);
  if (u.hostname.endsWith(".pooler.supabase.com") && u.port === "5432" && process.env.DB_SESSION_MODE !== "1") u.port = "6543";
  return u.toString();
}

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set — add it to .env.local");
  return runtimeDatabaseUrl(url);
}

function createDb() {
  const client = postgres(databaseUrl(), {
    max: process.env.VERCEL ? 3 : 8,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false, // safe with Supabase poolers
  });
  return drizzle(client, { schema });
}

declare global {
  // eslint-disable-next-line no-var
  var __kenfriDb: ReturnType<typeof createDb> | undefined;
}

/** One pool per warm process (dev reloads and serverless reuse it). */
export const db = globalThis.__kenfriDb ?? createDb();
globalThis.__kenfriDb = db;

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything that can run queries: the pool or an open transaction. */
export type DbOrTx = Db | Tx;

export * from "./schema";
