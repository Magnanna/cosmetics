import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/** Signed cookie naming the staff member switched in on a shared till PC. */

export const TILL_COOKIE = "kenfri_till_user";
export const TILL_TTL_MS = 12 * 3_600_000;

function secret(): string {
  const s = process.env.TILL_SESSION_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("Set TILL_SESSION_SECRET to use till user switching.");
  return createHmac("sha256", s).update("kenfri-till-session-v1").digest("hex");
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function encodeTillUser(orgId: number, memberId: number, loginUserId: string): string {
  const payload = Buffer.from(JSON.stringify({ o: orgId, m: memberId, u: loginUserId, e: Date.now() + TILL_TTL_MS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Returns the switched-in member id if the cookie is genuine, unexpired, and for this org and this device login. */
export function decodeTillUser(raw: string | undefined, orgId: number, loginUserId: string): number | null {
  if (!raw) return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { o, m, u, e } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { o: number; m: number; u: string; e: number };
    return o === orgId && u === loginUserId && e > Date.now() ? m : null;
  } catch {
    return null;
  }
}
