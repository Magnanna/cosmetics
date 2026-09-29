import "server-only";
import { and, eq } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import { db, members } from "@/db";
import { ctx, type Role } from "./context";

export class TeamError extends Error {}

export function staffLoginsEnabled(): boolean {
  return !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new TeamError("Adding staff needs SUPABASE_SERVICE_ROLE_KEY in .env.local (Supabase → Settings → API).");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).auth.admin;
}

const ROLES: Role[] = ["owner", "accountant", "staff", "cashier"];

/** The owner creates a login for a staff member with a starting password they hand over in person. */
export async function addStaff(p: { name: string; email: string; password: string; role: Role }): Promise<number> {
  const { orgId, role } = ctx();
  if (role !== "owner") throw new TeamError("Only the owner can add staff.");
  if (!ROLES.includes(p.role)) throw new TeamError("Pick a role.");
  if (!p.name.trim()) throw new TeamError("Enter their name.");
  if (p.password.length < 10) throw new TeamError("Use a starting password of at least 10 characters.");
  const email = p.email.trim().toLowerCase();
  const { data, error } = await admin().createUser({ email, password: p.password, email_confirm: true, user_metadata: { name: p.name.trim() } });
  if (error || !data.user) throw new TeamError(error?.message.includes("already") ? "That email already has a login." : error?.message ?? "Couldn't create the login.");
  try {
    const [m] = await db.insert(members).values({ orgId, userId: data.user.id, email, name: p.name.trim(), role: p.role }).returning({ id: members.id });
    return m.id;
  } catch (e) {
    await admin().deleteUser(data.user.id).catch(() => undefined);
    throw e;
  }
}

export async function updateStaff(memberId: number, patch: { role?: Role; active?: boolean }) {
  const { orgId, role, memberId: me } = ctx();
  if (role !== "owner") throw new TeamError("Only the owner can change staff.");
  if (memberId === me && (patch.active === false || (patch.role && patch.role !== "owner"))) throw new TeamError("You can't remove your own owner access.");
  if (patch.role && !ROLES.includes(patch.role)) throw new TeamError("Pick a role.");
  const [m] = await db.select().from(members).where(and(eq(members.orgId, orgId), eq(members.id, memberId))).limit(1);
  if (!m) throw new TeamError("Staff member not found.");
  await db.update(members).set(patch).where(eq(members.id, m.id));
  // Sign a deactivated person out everywhere.
  if (patch.active === false && staffLoginsEnabled()) await admin().signOut(m.userId).catch(() => undefined);
}
