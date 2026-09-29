import { and, eq } from "drizzle-orm";
import { registers, shifts, type DbOrTx, type Tx } from "@/db";
import { SYS } from "./coa";
import { ctx } from "./context";
import { acct, postEntry } from "./ledger";

export class ShiftError extends Error {}

export async function openShiftFor(db: DbOrTx, registerId: number) {
  const [row] = await db
    .select()
    .from(shifts)
    .where(and(eq(shifts.orgId, ctx().orgId), eq(shifts.registerId, registerId), eq(shifts.status, "open")))
    .limit(1);
  return row ?? null;
}

/** Starts a shift. The float moves from Cash at Hand into the drawer. */
export async function openShift(tx: Tx, p: { registerId: number; openingFloatCents: number; date: string }): Promise<number> {
  const { orgId, memberId } = ctx();
  if (!memberId) throw new ShiftError("Sign in to open the till.");
  if (!Number.isInteger(p.openingFloatCents) || p.openingFloatCents < 0) throw new ShiftError("The float can't be negative.");
  const [reg] = await tx.select({ id: registers.id }).from(registers).where(and(eq(registers.orgId, orgId), eq(registers.id, p.registerId))).limit(1);
  if (!reg) throw new ShiftError("Unknown till.");
  if (await openShiftFor(tx, p.registerId)) throw new ShiftError("This till already has an open shift.");

  const [shift] = await tx
    .insert(shifts)
    .values({ orgId, registerId: p.registerId, openedBy: memberId, openingFloatCents: p.openingFloatCents })
    .returning({ id: shifts.id });
  if (p.openingFloatCents > 0) {
    await postEntry(tx, {
      date: p.date,
      memo: "Opening float",
      sourceType: "shift_open",
      sourceId: shift.id,
      lines: [
        { accountId: await acct(tx, SYS.CASH_DRAWER), debitCents: p.openingFloatCents },
        { accountId: await acct(tx, SYS.CASH_AT_HAND), creditCents: p.openingFloatCents },
      ],
    });
  }
  return shift.id;
}
