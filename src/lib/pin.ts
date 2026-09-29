import "server-only";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, members } from "@/db";
import { ctx } from "./context";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export class PinError extends Error {}

export async function hashPin(pin: string): Promise<string> {
  if (!/^\d{4,6}$/.test(pin)) throw new PinError("A PIN is 4 to 6 digits.");
  if (/^(\d)\1+$/.test(pin) || "0123456789".includes(pin) || "9876543210".includes(pin)) throw new PinError("Pick a PIN that isn't a repeat or a run like 1234.");
  const salt = randomBytes(16);
  const key = await scrypt(pin, salt, 32);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

async function matches(pin: string, stored: string): Promise<boolean> {
  const [algo, saltHex, keyHex] = stored.split("$");
  if (algo !== "scrypt" || !saltHex || !keyHex) return false;
  const key = await scrypt(pin, Buffer.from(saltHex, "hex"), 32);
  const expected = Buffer.from(keyHex, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Wrong-PIN counter per org, so a PIN can't be guessed at the till. */
const failures = new Map<number, { count: number; until: number }>();
const MAX_TRIES = 5;
const LOCK_MS = 5 * 60_000;

/**
 * Checks an owner PIN typed on the till. Returns the approving owner's member
 * id. Five wrong tries lock owner approvals for five minutes.
 */
export async function verifyOwnerPin(pin: string): Promise<number> {
  const { orgId } = ctx();
  const f = failures.get(orgId);
  if (f && f.count >= MAX_TRIES && Date.now() < f.until) {
    throw new PinError(`Too many wrong PINs. Try again in ${Math.ceil((f.until - Date.now()) / 60_000)} min.`);
  }
  if (!/^\d{4,6}$/.test(pin)) throw new PinError("Enter the owner's 4–6 digit PIN.");
  const owners = await db
    .select({ id: members.id, pinHash: members.pinHash })
    .from(members)
    .where(and(eq(members.orgId, orgId), eq(members.role, "owner"), eq(members.active, true), isNotNull(members.pinHash)));
  if (owners.length === 0) throw new PinError("The owner hasn't set a PIN yet (Settings → My PIN).");
  for (const o of owners) {
    if (await matches(pin, o.pinHash!)) {
      failures.delete(orgId);
      return o.id;
    }
  }
  const next = { count: (f && Date.now() < f.until ? f.count : 0) + 1, until: Date.now() + LOCK_MS };
  failures.set(orgId, next);
  throw new PinError(next.count >= MAX_TRIES ? "Too many wrong PINs. Owner approvals are locked for 5 minutes." : "Wrong PIN.");
}
