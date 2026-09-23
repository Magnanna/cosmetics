import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, members, orgs, auditLog, type DbOrTx } from "@/db";
import { supabaseServer } from "./supabase/server";
import { ctx, runWithOrg, type Role } from "./context";
import { can, type Permission } from "./permissions";

export interface Session {
  userId: string;
  email: string;
  member: typeof members.$inferSelect;
  org: typeof orgs.$inferSelect;
  role: Role;
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
  return { userId: user.id, email: user.email ?? row.member.email, member: row.member, org: row.org, role: row.member.role as Role };
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
