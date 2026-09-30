import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db, members, orgs, auditLog, type DbOrTx } from "@/db";
import { supabaseServer } from "./supabase/server";
import { ctx, runWithOrg, type Role } from "./context";
import { can, type Permission } from "./permissions";
import { decodeTillUser, TILL_COOKIE } from "./till-cookie";

export interface Session {
  userId: string;
  email: string;
  /** The person acting: a staff member switched in by PIN on this device, or the signed-in login. */
  member: typeof members.$inferSelect;
  org: typeof orgs.$inferSelect;
  role: Role;
  /** The member the device is signed in as (differs from `member` after a till switch). */
  loginMember: typeof members.$inferSelect;
  switched: boolean;
}

/** The signed-in staff member and their org, or null. Cached per request. */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const [row] = await db
    .select({ member: members, org: orgs })
    .from(members)
    .innerJoin(orgs, eq(members.orgId, orgs.id))
    .where(and(eq(members.userId, user.id), eq(members.active, true)))
    .limit(1);
  if (!row) return null;
  const base = { userId: user.id, email: user.email ?? row.member.email, org: row.org, loginMember: row.member };
  // A staff member switched in by PIN on this device acts everywhere on it — never the login's (higher) role.
  const switchedId = decodeTillUser((await cookies()).get(TILL_COOKIE)?.value, row.org.id, user.id);
  if (switchedId && switchedId !== row.member.id) {
    const [m] = await db.select().from(members).where(and(eq(members.orgId, row.org.id), eq(members.id, switchedId), eq(members.active, true))).limit(1);
    if (m) return { ...base, member: m, role: m.role as Role, switched: true };
  }
  return { ...base, member: row.member, role: row.member.role as Role, switched: false };
});

export class ForbiddenError extends Error {}

/** For server actions: runs `fn` in the caller's org context, enforcing a permission. */
export async function withSession<T>(perm: Permission | null, fn: (s: Session) => Promise<T>): Promise<T> {
  const s = await getSession();
  if (!s) throw new ForbiddenError("Please sign in again.");
  if (perm && !can(s.role, perm)) throw new ForbiddenError("You don't have permission to do that.");
  return runWithOrg({ orgId: s.org.id, memberId: s.member.id, role: s.role }, () => fn(s));
}

/** For pages: redirects instead of throwing. Returns the session inside org context helpers. */
export async function requirePage(perm: Permission | null): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (perm && !can(s.role, perm)) redirect("/");
  return s;
}

/** Runs page data loading in the session's org context. */
export function inOrg<T>(s: Session, fn: () => Promise<T>): Promise<T> {
  return runWithOrg({ orgId: s.org.id, memberId: s.member.id, role: s.role }, fn);
}

/** Append-only audit trail. Call inside the same transaction as the change. */
export async function audit(
  db: DbOrTx,
  entry: { action: string; entity: string; entityId?: string | number; before?: unknown; after?: unknown }
) {
  const c = ctx();
  await db.insert(auditLog).values({
    orgId: c.orgId,
    memberId: c.memberId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId != null ? String(entry.entityId) : null,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}
