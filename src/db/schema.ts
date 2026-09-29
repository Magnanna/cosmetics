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
import { sql } from "drizzle-orm";

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

/* ---------------- Counters ---------------- */

/** Gap-free per-org sequences (receipt numbers, bill numbers). Incremented inside the posting transaction. */
export const counters = pgTable("counters", {
  orgId: integer("org_id").notNull().references(() => orgs.id),
  name: text("name").notNull(),
  value: integer("value").notNull().default(0),
}, (t) => [uniqueIndex("uq_counters_org_name").on(t.orgId, t.name)]);

/* ---------------- Supplier bills (stock in) ---------------- */

export const bills = pgTable("bills", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id),
  supplierInvoiceNo: text("supplier_invoice_no").notNull(),
  invoiceDate: text("invoice_date").notNull(),
  dueDate: text("due_date").notNull(),
  /** Lush prints VAT-inclusive rates; others add VAT on top. */
  ratesIncludeVat: boolean("rates_include_vat").notNull().default(true),
  vatBp: integer("vat_bp").notNull().default(1600),
  netCents: money("net_cents").notNull(),
  vatCents: money("vat_cents").notNull(),
  totalCents: money("total_cents").notNull(),
  paidCents: money("paid_cents").notNull().default(0),
  status: text("status").notNull().default("posted"), // posted | void
  journalEntryId: integer("journal_entry_id"),
  notes: text("notes"),
  memberId: integer("member_id"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("uq_bills_org_supplier_invoice").on(t.orgId, t.supplierId, t.supplierInvoiceNo),
  index("idx_bills_org_supplier").on(t.orgId, t.supplierId),
]);

export const billLines = pgTable("bill_lines", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  billId: integer("bill_id").notNull().references(() => bills.id),
  variantId: integer("variant_id").notNull().references(() => variants.id),
  supplierItemCode: text("supplier_item_code"),
  qty: integer("qty").notNull(), // in the supplier's unit
  unitsPerUom: integer("units_per_uom").notNull().default(1),
  rateCents: money("rate_cents").notNull(),
  units: integer("units").notNull(),
  totalCents: money("total_cents").notNull(), // VAT-inclusive, what enters Inventory
}, (t) => [index("idx_bill_lines_bill").on(t.billId)]);

export const supplierPayments = pgTable("supplier_payments", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id),
  date: text("date").notNull(),
  amountCents: money("amount_cents").notNull(),
  method: text("method").notNull(), // cash | mpesa | bank
  reference: text("reference"),
  journalEntryId: integer("journal_entry_id"),
  memberId: integer("member_id"),
  createdAt: createdAt(),
}, (t) => [index("idx_supplier_payments_org_supplier").on(t.orgId, t.supplierId)]);

export const supplierPaymentAllocations = pgTable("supplier_payment_allocations", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  paymentId: integer("payment_id").notNull().references(() => supplierPayments.id),
  billId: integer("bill_id").notNull().references(() => bills.id),
  amountCents: money("amount_cents").notNull(),
}, (t) => [index("idx_spa_bill").on(t.billId)]);

/* ---------------- Stock adjustments & stock takes ---------------- */

export const stockAdjustments = pgTable("stock_adjustments", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  variantId: integer("variant_id").notNull().references(() => variants.id),
  qtyDelta: integer("qty_delta").notNull(),
  reason: text("reason").notNull(), // damaged | lost | found | owner_use | other
  note: text("note"),
  costCents: money("cost_cents").notNull().default(0),
  journalEntryId: integer("journal_entry_id"),
  memberId: integer("member_id"),
  createdAt: createdAt(),
}, (t) => [index("idx_adjustments_org").on(t.orgId, t.createdAt)]);

/* ---------------- Till: shifts, sales ---------------- */

export const shifts = pgTable("shifts", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  registerId: integer("register_id").notNull().references(() => registers.id),
  openedBy: integer("opened_by").notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  openingFloatCents: money("opening_float_cents").notNull(),
  status: text("status").notNull().default("open"), // open | closed
  closedBy: integer("closed_by"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  countedCashCents: money("counted_cash_cents"),
  expectedCashCents: money("expected_cash_cents"),
  varianceCents: money("variance_cents"),
  zReport: jsonb("z_report"),
}, (t) => [
  index("idx_shifts_org_register").on(t.orgId, t.registerId, t.status),
  uniqueIndex("uq_shifts_one_open").on(t.registerId).where(sql`status = 'open'`),
]);

/** Cash put into or taken out of the drawer mid-shift. */
export const cashMovements = pgTable("cash_movements", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  shiftId: integer("shift_id").notNull().references(() => shifts.id),
  direction: text("direction").notNull(), // in | out
  reason: text("reason").notNull(), // petty_expense | owner_drawing | float_topup | other
  amountCents: money("amount_cents").notNull(),
  note: text("note"),
  journalEntryId: integer("journal_entry_id"),
  memberId: integer("member_id"),
  createdAt: createdAt(),
}, (t) => [index("idx_cash_movements_shift").on(t.shiftId)]);

export const sales = pgTable("sales", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  receiptNo: text("receipt_no").notNull(),
  /** Unguessable token for the public web receipt (/r/<token>). */
  receiptToken: text("receipt_token").notNull(),
  channel: text("channel").notNull().default("pos"), // pos | online
  registerId: integer("register_id").references(() => registers.id),
  shiftId: integer("shift_id").references(() => shifts.id),
  memberId: integer("member_id").notNull(),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  priceLevel: text("price_level").notNull(), // retail | wholesale
  businessDate: text("business_date").notNull(),
  grossCents: money("gross_cents").notNull(), // list prices × qty
  manualDiscountCents: money("manual_discount_cents").notNull().default(0),
  promoDiscountCents: money("promo_discount_cents").notNull().default(0),
  totalCents: money("total_cents").notNull(),
  costCents: money("cost_cents").notNull(),
  pointsEarned: bigint("points_earned_centipoints", { mode: "number" }).notNull().default(0),
  discountApprovedBy: integer("discount_approved_by"),
  status: text("status").notNull().default("completed"), // completed | partially_returned | returned
  idempotencyKey: text("idempotency_key").notNull(),
  journalEntryId: integer("journal_entry_id"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("uq_sales_org_receipt").on(t.orgId, t.receiptNo),
  uniqueIndex("uq_sales_org_idem").on(t.orgId, t.idempotencyKey),
  uniqueIndex("uq_sales_token").on(t.receiptToken),
  index("idx_sales_org_date").on(t.orgId, t.businessDate),
  index("idx_sales_org_customer").on(t.orgId, t.customerId),
  index("idx_sales_shift").on(t.shiftId),
]);

export const saleLines = pgTable("sale_lines", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  saleId: integer("sale_id").notNull().references(() => sales.id),
  variantId: integer("variant_id").notNull().references(() => variants.id),
  description: text("description").notNull(),
  qty: integer("qty").notNull(),
  unitPriceCents: money("unit_price_cents").notNull(),
  manualDiscountCents: money("manual_discount_cents").notNull().default(0),
  promoDiscountCents: money("promo_discount_cents").notNull().default(0),
  offerId: integer("offer_id"),
  lineTotalCents: money("line_total_cents").notNull(),
  costCents: money("cost_cents").notNull(),
  returnedQty: integer("returned_qty").notNull().default(0),
}, (t) => [index("idx_sale_lines_sale").on(t.saleId), index("idx_sale_lines_org_variant").on(t.orgId, t.variantId)]);

export const salePayments = pgTable("sale_payments", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  saleId: integer("sale_id").notNull().references(() => sales.id),
  method: text("method").notNull(), // cash | mpesa | credit | points
  amountCents: money("amount_cents").notNull(), // amount applied to the sale
  tenderedCents: money("tendered_cents"), // cash handed over
  changeCents: money("change_cents"),
  mpesaCode: text("mpesa_code"),
  /** For method "exchange": the return whose credit paid for this. */
  returnId: integer("return_id"),
  /** For method "points": centipoints spent. */
  pointsSpent: bigint("points_spent_centipoints", { mode: "number" }),
}, (t) => [
  index("idx_sale_payments_sale").on(t.saleId),
  uniqueIndex("uq_sale_payments_org_mpesa").on(t.orgId, t.mpesaCode),
]);

/**
 * Weekly stock take. Staff count blind; each line remembers what the system
 * said at the moment it was counted, so sales during the count don't create
 * false differences. Only the difference is posted on approval.
 */
export const stockTakes = pgTable("stock_takes", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  locationId: integer("location_id").notNull().references(() => locations.id),
  /** { all: true } | { categoryIds: number[] } | { brandIds: number[] } */
  scope: jsonb("scope").notNull(),
  scopeLabel: text("scope_label").notNull(),
  status: text("status").notNull().default("counting"), // counting | submitted | approved | cancelled
  startedBy: integer("started_by").notNull(),
  submittedBy: integer("submitted_by"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  decidedBy: integer("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  varianceCostCents: money("variance_cost_cents"),
  journalEntryId: integer("journal_entry_id"),
  createdAt: createdAt(),
}, (t) => [index("idx_stock_takes_org").on(t.orgId, t.status)]);

export const stockTakeLines = pgTable("stock_take_lines", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  stockTakeId: integer("stock_take_id").notNull().references(() => stockTakes.id),
  variantId: integer("variant_id").notNull().references(() => variants.id),
  countedQty: integer("counted_qty"),
  /** System on-hand when this line was last counted. */
  systemQtyAtCount: integer("system_qty_at_count"),
  countedBy: integer("counted_by"),
  countedAt: timestamp("counted_at", { withTimezone: true }),
  /** Filled on approval: qty and FIFO cost actually adjusted. */
  adjustedQty: integer("adjusted_qty"),
  adjustedCostCents: money("adjusted_cost_cents"),
}, (t) => [uniqueIndex("uq_stl_take_variant").on(t.stockTakeId, t.variantId)]);

/* ---------------- Scan-to-receive ---------------- */

/**
 * Shared barcode library (not per org, on purpose): what a barcode is called
 * and looks like, from our own shops or free online databases. Every shop
 * that names a product teaches the next one.
 */
export const barcodeLibrary = pgTable("barcode_library", {
  code: text("code").primaryKey(),
  name: text("name"),
  brand: text("brand"),
  size: text("size"),
  imageUrl: text("image_url"),
  source: text("source").notNull(), // shop | openbeautyfacts | openfoodfacts | upcitemdb | none
  lookedUpAt: timestamp("looked_up_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A delivery being scanned in. Becomes a supplier bill when posted. */
export const receivings = pgTable("receivings", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id),
  supplierInvoiceNo: text("supplier_invoice_no").notNull(),
  invoiceDate: text("invoice_date").notNull(),
  dueDate: text("due_date").notNull(),
  ratesIncludeVat: boolean("rates_include_vat").notNull().default(true),
  status: text("status").notNull().default("draft"), // draft | posted | discarded
  billId: integer("bill_id"),
  createdBy: integer("created_by").notNull(),
  createdAt: createdAt(),
}, (t) => [index("idx_receivings_org_status").on(t.orgId, t.status)]);

export const receivingLines = pgTable("receiving_lines", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  receivingId: integer("receiving_id").notNull().references(() => receivings.id),
  variantId: integer("variant_id").notNull().references(() => variants.id),
  qty: integer("qty").notNull(),
  /** Rate per unit as printed on the supplier invoice. Null until typed. */
  unitRateCents: money("unit_rate_cents"),
}, (t) => [uniqueIndex("uq_receiving_lines_variant").on(t.receivingId, t.variantId)]);

/** Short-lived link that lets a phone upload a product photo without signing in. */
export const photoTokens = pgTable("photo_tokens", {
  token: text("token").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  productId: integer("product_id").notNull().references(() => products.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

/* ---------------- Week 3: loyalty, returns, offers, credit, SMS ---------------- */

/** Every points movement. Points are centipoints (1,447.91 pts = 144791). */
export const loyaltyLedger = pgTable("loyalty_ledger", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  kind: text("kind").notNull(), // earn | bonus | redeem | reverse | adjust
  points: bigint("points_centipoints", { mode: "number" }).notNull(), // signed
  valueCents: money("value_cents").notNull(), // signed, what hit Loyalty Liability
  saleId: integer("sale_id"),
  returnId: integer("return_id"),
  note: text("note"),
  memberId: integer("member_id"),
  createdAt: createdAt(),
}, (t) => [index("idx_loyalty_customer").on(t.orgId, t.customerId)]);

export const saleReturns = pgTable("sale_returns", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  returnNo: text("return_no").notNull(),
  saleId: integer("sale_id").notNull().references(() => sales.id),
  shiftId: integer("shift_id").references(() => shifts.id),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  /** exchange = credit to spend now; refund = money back (owner PIN). */
  kind: text("kind").notNull(),
  refundMethod: text("refund_method"), // cash | mpesa | credit | points — for refunds
  totalCents: money("total_cents").notNull(),
  costCents: money("cost_cents").notNull(),
  /** Exchange credit not yet spent on a new sale. */
  creditLeftCents: money("credit_left_cents").notNull().default(0),
  approvedBy: integer("approved_by"),
  memberId: integer("member_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  journalEntryId: integer("journal_entry_id"),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("uq_returns_org_no").on(t.orgId, t.returnNo),
  uniqueIndex("uq_returns_org_idem").on(t.orgId, t.idempotencyKey),
  index("idx_returns_sale").on(t.saleId),
]);

export const saleReturnLines = pgTable("sale_return_lines", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  returnId: integer("return_id").notNull().references(() => saleReturns.id),
  saleLineId: integer("sale_line_id").notNull().references(() => saleLines.id),
  variantId: integer("variant_id").notNull().references(() => variants.id),
  qty: integer("qty").notNull(),
  amountCents: money("amount_cents").notNull(),
  costCents: money("cost_cents").notNull(),
}, (t) => [index("idx_return_lines_return").on(t.returnId)]);

/** Scheduled promotions, posted like announcements. */
export const offers = pgTable("offers", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  title: text("title").notNull(),
  description: text("description"),
  /** percent_off | amount_off | fixed_price | bonus_points | points_multiplier */
  type: text("type").notNull(),
  /** percent_off: basis points; amount_off/fixed_price: cents per unit; bonus_points: centipoints; points_multiplier: ×100. */
  value: integer("value").notNull(),
  /** bonus_points: spend on target items needed to qualify. */
  minSpendCents: money("min_spend_cents").notNull().default(0),
  audience: text("audience").notNull().default("all"), // all | retail | wholesale
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  active: boolean("active").notNull().default(true),
  createdBy: integer("created_by"),
  createdAt: createdAt(),
}, (t) => [index("idx_offers_org_window").on(t.orgId, t.startsAt, t.endsAt)]);

export const offerTargets = pgTable("offer_targets", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  offerId: integer("offer_id").notNull().references(() => offers.id),
  kind: text("kind").notNull(), // variant | product | brand | category
  targetId: integer("target_id").notNull(),
}, (t) => [index("idx_offer_targets_offer").on(t.offerId)]);

/** Money received from credit customers against what they owe. */
export const customerPayments = pgTable("customer_payments", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  date: text("date").notNull(),
  amountCents: money("amount_cents").notNull(),
  method: text("method").notNull(), // cash | mpesa | bank
  mpesaCode: text("mpesa_code"),
  reference: text("reference"),
  shiftId: integer("shift_id"),
  journalEntryId: integer("journal_entry_id"),
  memberId: integer("member_id"),
  createdAt: createdAt(),
}, (t) => [
  index("idx_customer_payments_customer").on(t.orgId, t.customerId),
  uniqueIndex("uq_customer_payments_mpesa").on(t.orgId, t.mpesaCode),
]);

export const smsLog = pgTable("sms_log", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().references(() => orgs.id),
  customerId: integer("customer_id"),
  to: text("to").notNull(),
  category: text("category").notNull(), // receipt | credit | points | owner | marketing
  body: text("body").notNull(),
  status: text("status").notNull(), // sent | failed | skipped
  providerId: text("provider_id"),
  costText: text("cost_text"),
  error: text("error"),
  createdAt: createdAt(),
}, (t) => [index("idx_sms_org_time").on(t.orgId, t.createdAt)]);
