import { and, eq } from "drizzle-orm";
import { accounts, journalEntries, journalLines, orgs, type DbOrTx, type Tx } from "@/db";
import { ctx } from "./context";

/**
 * The ledger — the ONLY writer to journal_entries / journal_lines.
 * Every posting runs inside the caller's transaction, so a sale, its stock
 * movement and its journal commit together or not at all.
 */

export interface PostLine {
  accountId: number;
  debitCents?: number;
  creditCents?: number;
  customerId?: number | null;
  supplierId?: number | null;
  memo?: string;
}

export interface PostParams {
  date: string; // YYYY-MM-DD
  memo?: string;
  sourceType: string;
  sourceId?: number;
  reversalOfId?: number;
  lines: PostLine[];
}

const accountIdCache = new Map<string, number>();

/** Resolves a system account code (see SYS) to this org's account id. */
export async function acct(db: DbOrTx, code: string): Promise<number> {
  const { orgId } = ctx();
  const key = `${orgId}:${code}`;
  const hit = accountIdCache.get(key);
  if (hit) return hit;
  const [row] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), eq(accounts.code, code)))
    .limit(1);
  if (!row) throw new Error(`Account ${code} is missing for this organisation — run the seed.`);
  accountIdCache.set(key, row.id);
  return row.id;
}

export class UnbalancedEntryError extends Error {}
export class BooksLockedError extends Error {}

/** Posts one balanced journal entry. Throws if debits ≠ credits or the period is locked. */
export async function postEntry(tx: Tx, p: PostParams): Promise<number> {
  const { orgId, memberId } = ctx();
  for (const l of p.lines) {
    if ((l.debitCents ?? 0) < 0 || (l.creditCents ?? 0) < 0) {
      throw new UnbalancedEntryError(`Negative amount on a journal line (${p.sourceType}) — flip debit/credit instead.`);
    }
    if (!Number.isInteger(l.debitCents ?? 0) || !Number.isInteger(l.creditCents ?? 0)) {
      throw new UnbalancedEntryError(`Non-integer cents on a journal line (${p.sourceType}).`);
    }
  }
  const lines = p.lines.filter((l) => (l.debitCents ?? 0) !== 0 || (l.creditCents ?? 0) !== 0);
  if (lines.length === 0) throw new UnbalancedEntryError(`Empty journal entry (${p.sourceType}).`);
  const dr = lines.reduce((s, l) => s + (l.debitCents ?? 0), 0);
  const cr = lines.reduce((s, l) => s + (l.creditCents ?? 0), 0);
  if (dr !== cr) throw new UnbalancedEntryError(`Unbalanced entry (${p.sourceType}): debits ${dr} ≠ credits ${cr}.`);

  const [org] = await tx.select({ lockDate: orgs.lockDate }).from(orgs).where(eq(orgs.id, orgId)).limit(1);
  if (org?.lockDate && p.date <= org.lockDate) {
    throw new BooksLockedError(`The books are closed up to ${org.lockDate}. This entry is dated ${p.date}.`);
  }

  const [entry] = await tx
    .insert(journalEntries)
    .values({
      orgId,
      date: p.date,
      memo: p.memo,
      sourceType: p.sourceType,
      sourceId: p.sourceId,
      reversalOfId: p.reversalOfId,
      memberId,
    })
    .returning({ id: journalEntries.id });

  await tx.insert(journalLines).values(
    lines.map((l) => ({
      orgId,
      entryId: entry.id,
      accountId: l.accountId,
      debitCents: l.debitCents ?? 0,
      creditCents: l.creditCents ?? 0,
      customerId: l.customerId ?? null,
      supplierId: l.supplierId ?? null,
      memo: l.memo,
    }))
  );
  return entry.id;
}

/** Posts the mirror image of an entry. Entries are never edited or deleted. */
export async function reverseEntry(tx: Tx, entryId: number, date: string, memo: string): Promise<number> {
  const { orgId } = ctx();
  const [src] = await tx
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.orgId, orgId), eq(journalEntries.id, entryId)))
    .limit(1);
  if (!src) throw new Error(`Journal entry ${entryId} not found.`);
  const lines = await tx
    .select()
    .from(journalLines)
    .where(and(eq(journalLines.orgId, orgId), eq(journalLines.entryId, entryId)));
  return postEntry(tx, {
    date,
    memo,
    sourceType: `${src.sourceType}_reversal`,
    sourceId: src.sourceId ?? undefined,
    reversalOfId: entryId,
    lines: lines.map((l) => ({
      accountId: l.accountId,
      debitCents: l.creditCents,
      creditCents: l.debitCents,
      customerId: l.customerId,
      supplierId: l.supplierId,
      memo: l.memo ?? undefined,
    })),
  });
}

/** Signed helper: positive amount → debit `a`/credit `b`; negative → the reverse. */
export function signedPair(amount: number, a: number, b: number, memo?: string): PostLine[] {
  if (amount === 0) return [];
  return amount > 0
    ? [{ accountId: a, debitCents: amount, memo }, { accountId: b, creditCents: amount, memo }]
    : [{ accountId: b, debitCents: -amount, memo }, { accountId: a, creditCents: -amount, memo }];
}
