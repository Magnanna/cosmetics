/**
 * Kenfri POS schema.
 *
 * Rules:
 * - Every business table carries `org_id` (multi-tenant from day one).
 * - Money is integer cents (bigint, read as JS number). Quantities are integer units.
 * - Loyalty points are stored in hundredths ("centipoints") so 1,447.91 pts is exact.
 * - journal_entries / journal_lines are append-only; only src/lib/ledger writes them.
 */
import {
  pgTable,
  serial,
  integer,
  bigint,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const money = (name: string) => bigint(name, { mode: "number" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/* ---------------- Tenancy & people ---------------- */

export const orgs = pgTable("orgs", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  kraPin: text("kra_pin"),
  logoUrl: text("logo_url"),
  brandColor: text("brand_color").notNull().default("#5A2132"),
  timezone: text("timezone").notNull().default("Africa/Nairobi"),
  currency: text("currency").notNull().default("KES"),
  /** tot | vat | none — VAT mode is dormant in v1. */
  taxMode: text("tax_mode").notNull().default("tot"),
  /** Turnover Tax rate in basis points (150 = 1.5%). */
  totRateBp: integer("tot_rate_bp").notNull().default(150),
  /** Books are closed on and before this date (YYYY-MM-DD). */
  lockDate: text("lock_date"),
  /** Manual discount a cashier may give per sale without owner PIN. */
  cashierDiscountLimitCents: money("cashier_discount_limit_cents").notNull().default(50_000),
  returnWindowHours: integer("return_window_hours").notNull().default(24),
  allowNegativeStock: boolean("allow_negative_stock").notNull().default(true),
  /** Loyalty: cents spent per 1 point earned (1000 = 1 pt per KES 10). */
  loyaltyEarnCentsPerPoint: integer("loyalty_earn_cents_per_point").notNull().default(1000),
  /** Loyalty: value of 1 point in cents (10 = KES 0.10). */
  loyaltyPointValueCents: integer("loyalty_point_value_cents").notNull().default(10),
  /** Loyalty: minimum balance value before points can be redeemed. */
  loyaltyMinRedeemCents: money("loyalty_min_redeem_cents").notNull().default(10_000),
  clockInEnabled: boolean("clock_in_enabled").notNull().default(false),
  receiptFooter: text("receipt_footer"),
  createdAt: createdAt(),
});

/** owner | accountant | staff | cashier */
export const members = pgTable("members", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  userId: text("user_id").notNull().unique(), // Supabase auth.users uuid
  email: text("email").notNull(),
  name: text("name").notNull().default(""),
  role: text("role").notNull().default("cashier"),
  /** scrypt hash of the 4–6 digit till PIN. */
  pinHash: text("pin_hash"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [index("idx_members_org").on(t.orgId)]);

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  memberId: integer("member_id"),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  createdAt: createdAt(),
}, (t) => [index("idx_audit_org_time").on(t.orgId, t.createdAt)]);

/* ---------------- Ledger ---------------- */

export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  /** asset | liability | equity | income | expense */
  type: text("type").notNull(),
  subtype: text("subtype").notNull().default("other"),
  description: text("description"),
  isSystem: boolean("is_system").notNull().default(false),
  archived: boolean("archived").notNull().default(false),
}, (t) => [uniqueIndex("uq_accounts_org_code").on(t.orgId, t.code)]);

export const journalEntries = pgTable("journal_entries", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  date: text("date").notNull(), // YYYY-MM-DD, Nairobi business day
  memo: text("memo"),
  sourceType: text("source_type").notNull(),
  sourceId: integer("source_id"),
  reversalOfId: integer("reversal_of_id"),
  memberId: integer("member_id"),
  createdAt: createdAt(),
}, (t) => [
  index("idx_je_org_date").on(t.orgId, t.date),
  index("idx_je_org_source").on(t.orgId, t.sourceType, t.sourceId),
]);

export const journalLines = pgTable("journal_lines", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  entryId: integer("entry_id").notNull().references(() => journalEntries.id),
  accountId: integer("account_id").notNull().references(() => accounts.id),
  debitCents: money("debit_cents").notNull().default(0),
  creditCents: money("credit_cents").notNull().default(0),
  customerId: integer("customer_id"),
  supplierId: integer("supplier_id"),
  memo: text("memo"),
}, (t) => [
  index("idx_jl_org_entry").on(t.orgId, t.entryId),
  index("idx_jl_org_account").on(t.orgId, t.accountId),
]);

/* ---------------- Locations ---------------- */

/** A place stock lives. v1 has one shop; `online` comes with the web store. */
export const locations = pgTable("locations", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("shop"), // shop | online
  isDefault: boolean("is_default").notNull().default(false),
}, (t) => [index("idx_locations_org").on(t.orgId)]);

export const registers = pgTable("registers", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  locationId: integer("location_id").notNull().references(() => locations.id),
  name: text("name").notNull(),
  printerName: text("printer_name"),
}, (t) => [index("idx_registers_org").on(t.orgId)]);

/* ---------------- Catalog ---------------- */

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  parentId: integer("parent_id"),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  archived: boolean("archived").notNull().default(false),
}, (t) => [index("idx_categories_org").on(t.orgId)]);

export const brands = pgTable("brands", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  name: text("name").notNull(),
  archived: boolean("archived").notNull().default(false),
}, (t) => [uniqueIndex("uq_brands_org_name").on(t.orgId, t.name)]);

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  name: text("name").notNull(),
  brandId: integer("brand_id").references(() => brands.id),
  categoryId: integer("category_id").references(() => categories.id),
  description: text("description"),
  imageUrl: text("image_url"),
  /** Up to two option types, e.g. "Shade", "Size". Null = single default variant. */
  option1Name: text("option1_name"),
  option2Name: text("option2_name"),
  archived: boolean("archived").notNull().default(false),
  /** Sales channels this product is published to (pos now, online later). */
  channels: text("channels").array().notNull().default(["pos"]),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("idx_products_org").on(t.orgId), index("idx_products_org_brand").on(t.orgId, t.brandId)]);

/** The unit that is stocked, priced, sold and reported on. */
export const variants = pgTable("variants", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  productId: integer("product_id").notNull().references(() => products.id),
  option1Value: text("option1_value"),
  option2Value: text("option2_value"),
  sku: text("sku"),
  retailPriceCents: money("retail_price_cents").notNull().default(0),
  wholesalePriceCents: money("wholesale_price_cents").notNull().default(0),
  reorderLevel: integer("reorder_level").notNull().default(0),
  swatchHex: text("swatch_hex"),
  imageUrl: text("image_url"),
  archived: boolean("archived").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [
  index("idx_variants_org_product").on(t.orgId, t.productId),
  uniqueIndex("uq_variants_org_sku").on(t.orgId, t.sku),
]);

export const variantBarcodes = pgTable("variant_barcodes", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  variantId: integer("variant_id").notNull().references(() => variants.id),
  code: text("code").notNull(),
  source: text("source").notNull().default("manufacturer"), // manufacturer | generated
}, (t) => [uniqueIndex("uq_barcodes_org_code").on(t.orgId, t.code), index("idx_barcodes_variant").on(t.variantId)]);

/** Staff-suggested price changes awaiting owner approval. */
export const priceChangeRequests = pgTable("price_change_requests", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  variantId: integer("variant_id").notNull().references(() => variants.id),
  field: text("field").notNull(), // retail | wholesale
  oldCents: money("old_cents").notNull(),
  newCents: money("new_cents").notNull(),
  reason: text("reason"),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  requestedBy: integer("requested_by").notNull(),
  decidedBy: integer("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("idx_pcr_org_status").on(t.orgId, t.status)]);

/* ---------------- Suppliers & stock ---------------- */

export const suppliers = pgTable("suppliers", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  name: text("name").notNull(),
  kraPin: text("kra_pin"),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  paymentDetails: text("payment_details"),
  termsDays: integer("terms_days").notNull().default(0),
  archived: boolean("archived").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [index("idx_suppliers_org").on(t.orgId)]);

/** How a supplier names and packs a variant, e.g. FGWHDLIT01-40 in cartons of 48. */
export const variantSuppliers = pgTable("variant_suppliers", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  variantId: integer("variant_id").notNull().references(() => variants.id),
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id),
  supplierItemCode: text("supplier_item_code"),
  purchaseUom: text("purchase_uom").notNull().default("PCS"),
  unitsPerUom: integer("units_per_uom").notNull().default(1),
  lastCostCents: money("last_cost_cents"),
}, (t) => [
  uniqueIndex("uq_vs_org_supplier_code").on(t.orgId, t.supplierId, t.supplierItemCode),
  index("idx_vs_variant").on(t.variantId),
]);

/**
 * FIFO cost lots. Each lot tracks remaining quantity AND remaining cost, so
 * consuming the last unit takes exactly what's left — the sum of
 * remaining_cost_cents always equals the Inventory account balance.
 */
export const stockLots = pgTable("stock_lots", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  variantId: integer("variant_id").notNull().references(() => variants.id),
  locationId: integer("location_id").notNull().references(() => locations.id),
  date: text("date").notNull(),
  qty: integer("qty").notNull(),
  remainingQty: integer("remaining_qty").notNull(),
  totalCostCents: money("total_cost_cents").notNull(),
  remainingCostCents: money("remaining_cost_cents").notNull(),
  sourceType: text("source_type").notNull(), // opening | bill | return | adjustment | stocktake
  sourceId: integer("source_id"),
  createdAt: createdAt(),
}, (t) => [index("idx_lots_org_variant_loc").on(t.orgId, t.variantId, t.locationId)]);

/** Every change in on-hand quantity, for history and on-hand queries. */
export const stockMovements = pgTable("stock_movements", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  variantId: integer("variant_id").notNull().references(() => variants.id),
  locationId: integer("location_id").notNull().references(() => locations.id),
  qtyDelta: integer("qty_delta").notNull(),
  costCents: money("cost_cents").notNull(), // signed: + into stock, − out
  sourceType: text("source_type").notNull(),
  sourceId: integer("source_id"),
  createdAt: createdAt(),
}, (t) => [index("idx_moves_org_variant").on(t.orgId, t.variantId, t.locationId)]);

/* ---------------- Customers ---------------- */

export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  /** Normalised 2547XXXXXXXX / 2541XXXXXXXX. */
  phone: text("phone").notNull(),
  name: text("name"),
  type: text("type").notNull().default("retail"), // retail | wholesale
  businessName: text("business_name"),
  birthday: text("birthday"), // MM-DD
  marketingConsent: boolean("marketing_consent").notNull().default(false),
  consentAt: timestamp("consent_at", { withTimezone: true }),
  /** Null = follow type default (retail earns, wholesale doesn't). */
  earnsPointsOverride: boolean("earns_points_override"),
  pointsBalance: bigint("points_balance_centipoints", { mode: "number" }).notNull().default(0),
  creditEnabled: boolean("credit_enabled").notNull().default(false),
  creditLimitCents: money("credit_limit_cents").notNull().default(0),
  creditTermsDays: integer("credit_terms_days").notNull().default(30),
  notes: text("notes"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("uq_customers_org_phone").on(t.orgId, t.phone)]);
