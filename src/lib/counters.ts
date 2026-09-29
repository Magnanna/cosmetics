import { sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { ctx } from "./context";

/**
 * Next value of a per-org counter. The upsert row-locks the counter until the
 * transaction ends, so numbers are gap-free and never duplicated — a rolled-back
 * sale gives its number back.
 */
export async function nextCounter(tx: Tx, name: string): Promise<number> {
  const { orgId } = ctx();
  const rows = await tx.execute<{ value: number }>(sql`
    insert into counters (org_id, name, value) values (${orgId}, ${name}, 1)
    on conflict (org_id, name) do update set value = counters.value + 1
    returning value`);
  return Number(rows[0].value);
}

export function formatReceiptNo(n: number): string {
  return `KF-${String(n).padStart(6, "0")}`;
}
