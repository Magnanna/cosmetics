import type { Role } from "./context";

/**
 * What each role may do. Checked server-side on every action and page —
 * hiding a button is never the only guard.
 */
export const PERMISSIONS = {
  "till.sell": ["owner", "cashier"],
  "till.refund": ["owner"],
  "till.discount_unlimited": ["owner"],
  "catalog.view": ["owner", "staff", "accountant", "cashier"],
  "catalog.edit": ["owner", "staff"],
  "catalog.set_prices": ["owner"],
  "catalog.view_costs": ["owner", "staff", "accountant"],
  "stock.receive": ["owner", "staff"],
  "stock.count": ["owner", "staff"],
  "stock.approve": ["owner"],
  "suppliers.edit": ["owner", "staff", "accountant"],
  "customers.view": ["owner", "staff", "accountant", "cashier"],
  "customers.edit": ["owner", "staff", "cashier"],
  "customers.credit": ["owner"],
  "books.view": ["owner", "accountant"],
  "books.post": ["owner", "accountant"],
  "books.lock": ["owner"],
  "reports.view": ["owner", "accountant"],
  "team.manage": ["owner"],
  "settings.edit": ["owner"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, perm: Permission): boolean {
  return (PERMISSIONS[perm] as readonly Role[]).includes(role);
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  accountant: "Accountant",
  staff: "Staff",
  cashier: "Cashier",
};
