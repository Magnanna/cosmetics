import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set — add it to .env.local");
  return url;
}

function createDb() {
  const client = postgres(databaseUrl(), {
    max: 10,
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
