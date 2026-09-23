import { AsyncLocalStorage } from "node:async_hooks";

export type Role = "owner" | "accountant" | "staff" | "cashier";

export interface OrgContext {
  orgId: number;
  memberId: number | null;
  role: Role;
}

const storage = new AsyncLocalStorage<OrgContext>();

/** Runs `fn` with an org context. Server actions enter via `withSession` in auth.ts. */
export function runWithOrg<T>(ctx: OrgContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

export function ctx(): OrgContext {
  const c = storage.getStore();
  if (!c) throw new Error("No organisation in context — call inside runWithOrg()/withSession().");
  return c;
}

export function orgId(): number {
  return ctx().orgId;
}
