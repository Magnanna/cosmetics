"use server";

import { and, eq } from "drizzle-orm";
import { db, members, orgs } from "@/db";
import { supabaseServer } from "@/lib/supabase/server";

const ORG_SLUG = process.env.SEED_ORG_SLUG ?? "kenfri";

export async function ownerExists(): Promise<boolean> {
  const [org] = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.slug, ORG_SLUG)).limit(1);
  if (!org) return false;
  const [m] = await db.select({ id: members.id }).from(members).where(and(eq(members.orgId, org.id), eq(members.role, "owner"))).limit(1);
  return !!m;
}

/** One-time: creates the first owner login. Refuses once any owner exists. */
export async function createOwner(_: unknown, form: FormData): Promise<{ error?: string; confirmEmail?: boolean; done?: boolean }> {
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!name || !email) return { error: "Enter your name and email." };
  if (password.length < 10) return { error: "Use a password of at least 10 characters." };

  const [org] = await db.select().from(orgs).where(eq(orgs.slug, ORG_SLUG)).limit(1);
  if (!org) return { error: "The shop hasn't been set up yet — run the seed first." };
  if (await ownerExists()) return { error: "An owner already exists. Sign in instead." };

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error || !data.user) return { error: error?.message ?? "Could not create the account." };

  try {
    await db.insert(members).values({ orgId: org.id, userId: data.user.id, email, name, role: "owner" });
  } catch {
    return { error: "This login is already linked to a shop." };
  }
  return data.session ? { done: true } : { confirmEmail: true };
}
