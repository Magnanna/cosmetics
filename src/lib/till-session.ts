import "server-only";
import { cookies } from "next/headers";
import { encodeTillUser, TILL_COOKIE, TILL_TTL_MS } from "./till-cookie";

/**
 * Staff switching on the shared till PC. The PC stays signed in with one
 * login; whoever last entered their PIN acts on this device (see getSession).
 */
export async function setTillUser(orgId: number, memberId: number, loginUserId: string) {
  (await cookies()).set(TILL_COOKIE, encodeTillUser(orgId, memberId, loginUserId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TILL_TTL_MS / 1000,
  });
}

export async function clearTillUser() {
  (await cookies()).delete(TILL_COOKIE);
}
