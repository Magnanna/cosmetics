# PRD: Kenfri POS — Cosmetics Point of Sale with Built-in Accounting

> Version 1.0 · 2026-09-24 · Owner: Ian Love · Status: Draft for review
> Client: **Kenfri Cosmetics** (single shop, single till, Kenya)
> Source system for reused modules: **Zeno** (`~/workspaces/zoho-books-clone copy 3`)

---

## 1. Introduction / Overview

Kenfri POS is a desktop point-of-sale system for a Kenyan cosmetics retail shop, with a full double-entry accounting back office built in. It is **not** a generic supermarket till: it is designed around how a beauty shop actually sells — shades and sizes, retail and salon (wholesale) customers, mandatory phone capture for loyalty and SMS marketing, and strict "no returns once opened" rules — with a calm, premium look (Shopify POS layout, Zeno "Apple calm" design tokens, Masterpiece red accent).

Every sale, return, cash movement, stock receipt and loyalty movement posts to an append-only double-entry ledger in real time, so the owner gets a live P&L, Balance Sheet, Turnover Tax figure and stock valuation without a separate accounting package.

The system is built as a fresh codebase, copying proven modules from Zeno (ledger/posting engine, FIFO inventory, reports, payroll, SMS, roles). It is multi-tenant from day one (every row carries `org_id`) so other cosmetics shops can be onboarded later, and its product/order model is channel-aware so an online store can be added without re-architecture.

### Business facts that shape the design

| Fact | Consequence |
|---|---|
| Single shop, single till, desktop PC | One register per org in v1; model supports many later |
| Daily sales peak ≈ KES 30–50k | Modest volume; no heavy performance engineering needed |
| **Not VAT registered; files Turnover Tax (TOT)** | No VAT on sales, no eTIMS. Supplier VAT is **not claimable** → capitalised into stock cost. Monthly TOT report + posting |
| Stable internet | **No offline mode.** Online-only with safe failure handling |
| Hardware: Xprinter XP-Q80 (80mm, USB, ESC/POS), barcode scanner, cash drawer (RJ11 via printer) | Desktop shell (Tauri) with raw USB printing + drawer kick |
| M-Pesa via **Till number**; cashier types the M-Pesa code | No STK push, no Daraja C2B in v1. Codes stored & reconciled against statement |
| Customers: retail, salons (wholesale), credit customers | Two price levels; credit accounts with limits; statements & aging |
| Products don't expire | No batch/expiry tracking |
| Most products carry manufacturer barcodes; some don't | Support manufacturer barcodes + system-generated in-store barcodes |
| Owner is effectively the accountant (+ occasional remote accountant) | Plain-language back office; accountant role read/post access |
| Team: 2 builders, ~4 weeks | Hard v1 scope; everything else in v1.5 / v2 |

### Sample supplier invoice analysis (Lush Hair / Tolaram, 20-Feb-2025)

The received invoice shows what stock intake looks like:

- Supplier item code (e.g. `FGWHDLIT01-40`), description with **size baked in** ("…LEAVE-IN TREATMENT 40G"), UOM `PCS`, quantity (48), rate (KES 25.00), VAT 16%, line value.
- Some supplier SKUs are **multi-packs sold as one unit** ("COMBO PACK … SHAMPOO 35G & CONDITIONER", "TWIN PACK 45G") → treat as a single sellable SKU, not a bundle.
- Supplier terms: goods remain supplier property until paid; payment by cheque/RTGS/paybill → **supplier credit (Accounts Payable)** is normal.
- Totals: the four line values sum to **6,960**, the amount payable. The printed rates are **VAT-inclusive**: the supplier backs VAT out of the total (6,960 = 6,000 net + 960 VAT). Because Kenfri is not VAT registered, the full VAT-inclusive amount is the stock cost, so the leave-in costs **KES 25.00 per unit**. Other suppliers print net rates and add VAT on top, so receiving must support both (a "rates include VAT" switch per bill).

A larger multi-item invoice (to be supplied) will validate the variant model (shade/size) in §4.1.

---

## 2. Goals

- G1: Ring up a typical 3-item retail sale (scan, attach customer by phone, take cash/M-Pesa, print receipt) in **under 30 seconds**.
- G2: Every financial event posts to the ledger in real time; Trial Balance always balances; stock value on Balance Sheet equals FIFO stock valuation report.
- G3: End-of-day cash-up with variance per cashier in **under 5 minutes**.
- G4: 100% of sales linked to a customer phone number → a marketing-ready customer base from day one.
- G5: Owner sees today's sales, gross margin, cash position, credit owed, and low stock on one dashboard and via a daily SMS summary.
- G6: Monthly Turnover Tax amount available in one click.
- G7: Architecture ready for (a) additional cosmetics shops as tenants, (b) an online store channel — without schema rewrites.

---

## 3. Users & Roles

| Role | Who | Can |
|---|---|---|
| **Owner** | Shop owner | Everything. Approves discounts > KES 500, price changes, credit limits, write-offs, refunds. Sets wholesale prices. |
| **Accountant** | Owner or remote accountant | Back-office finance: journals, expenses, bills, reports, period lock, TOT. No till. |
| **Staff** | Shop staff (may also run till) | Receive stock, stock takes, create products, **suggest** retail/wholesale prices (owner approves), customer management. Till access if also granted Cashier. |
| **Cashier** | Till operator | Open/close shift, sell, returns/exchanges within policy, discounts ≤ KES 500 total per sale, cash in/out with reason. Cannot see cost price or margins. |

- One login per person (email + password for back office; **4–6 digit PIN** for fast till switching after first login on the device).
- Permissions stored as a role → permission matrix (copy Zeno `rolePermissions` / `customRoles` / `guard.ts`) so new roles can be added later without code changes.

---

## 4. Scope by Release

| Release | Window | Contents |
|---|---|---|
| **v1 (MVP)** | Weeks 1–4 | Foundation, catalog, stock intake & stock take, till (sell, pay, print, drawer), returns/exchanges, shifts & cash-up, customers (mandatory phone), credit accounts, loyalty, offers engine, transactional SMS, ledger + core reports, TOT, owner dashboard |
| **v1.5** | Weeks 5–8 | Payroll (copy Zeno), optional clock-in, marketing SMS campaigns + automations, approval by phone, suggested credit limits, purchase orders, label printing, M-Pesa statement auto-reconcile, budgets |
| **v2** | Later | Online store channel, customer loyalty app/web card (Carrefour MyCLUB-style barcode), multi-till/multi-branch, super-admin SaaS onboarding & billing, VAT/eTIMS switch-on, STK push / C2B auto-match |

---

## 5. User Stories

Stories are grouped by epic. Each is sized for one focused session. `[v1]` / `[v1.5]` marks release.

All UI stories implicitly include: **Typecheck/lint passes** and **Verify in browser using dev-browser skill**. All data stories include **Typecheck passes** and **migration applies cleanly**.

### Epic A — Foundation

#### US-A1: Multi-tenant schema foundation `[v1]`
**Description:** As a developer, I need every business table scoped to an organisation so other shops can use the system later.
**Acceptance Criteria:**
- [ ] `orgs` table (id, name, slug, phone, address, KRA PIN, logo, brand colour, timezone default `Africa/Nairobi`, currency `KES`, tax_mode `tot|vat|none`)
- [ ] Every business table has non-null `org_id` FK + index
- [ ] Supabase Row-Level Security policies restrict all reads/writes to the user's org
- [ ] Server-side `requireOrg()` guard used by every server action (ported from Zeno `guard.ts`)
- [ ] Seed script creates "Kenfri Cosmetics" org + owner user

#### US-A2: Auth, roles and permissions `[v1]`
**Description:** As the owner, I want each staff member to have their own login and role so actions are traceable.
**Acceptance Criteria:**
- [ ] Email/password login (Supabase Auth); owner can invite users by email and assign role
- [ ] Roles Owner/Accountant/Staff/Cashier seeded with permission matrix in §3
- [ ] Owner can deactivate a user; deactivated users cannot log in
- [ ] Till PIN (4–6 digits, hashed) per user for quick switching on the till device

#### US-A3: Audit log `[v1]`
**Description:** As the owner, I want every sensitive action logged so I can investigate problems.
**Acceptance Criteria:**
- [ ] Append-only `audit_log` (org_id, user_id, action, entity, entity_id, before/after JSON, timestamp)
- [ ] Logged: price changes, discounts, approvals, voids, returns, cash in/out, stock adjustments, credit limit changes, role changes, period lock
- [ ] Owner can filter log by user, action and date

#### US-A4: Desktop shell with printer and drawer `[v1]`
**Description:** As a cashier, I want the till to run as a desktop app that prints receipts and opens the drawer.
**Acceptance Criteria:**
- [ ] Tauri 2 app loads the hosted web app (till route) in a full-screen window
- [ ] Rust command `print_receipt(bytes)` sends raw ESC/POS to the XP-Q80 over USB
- [ ] Rust command `open_drawer()` sends ESC/POS drawer-kick (`ESC p 0 25 250`)
- [ ] Settings screen lists detected printers, lets owner pick one, and prints a test page
- [ ] Web app detects whether it's running inside the shell; outside the shell, falls back to browser print (for back-office use)

#### US-A5: Design system tokens `[v1]`
**Description:** As a developer, I need Zeno's design tokens with the Kenfri Masterpiece red accent so the whole app looks consistent.
**Acceptance Criteria:**
- [ ] `globals.css` ports Zeno tokens (§8) with `--color-brand: #5A2132`
- [ ] Shared components: Button (primary/secondary/ghost), Card, StatusPill, MoneyText (tabular), Input, Select, Modal, Sheet, Toast, EmptyState, NumPad
- [ ] Light mode only

### Epic B — Catalog

#### US-B1: Categories and brands `[v1]`
**Description:** As staff, I want to organise products by category and brand so the till and reports are easy to navigate.
**Acceptance Criteria:**
- [ ] Categories (2 levels, e.g. Hair → Relaxers) seeded: Hair, Skin care, Makeup, Nails, Perfumes & deodorants, Bath, Baby care, Shaving & hair removal, Sanitary, Jewelry, Innerwear, Equipment & accessories
- [ ] Brands table (e.g. Lush Hair) with optional logo
- [ ] CRUD screens for both; cannot delete if products attached (archive instead)

#### US-B2: Products with variants `[v1]`
**Description:** As staff, I want to create a product once and add its shades/sizes as variants so the till shows them grouped.
**Acceptance Criteria:**
- [ ] `products` (name, brand, category, description, image, status) and `variants` (product_id, option values e.g. `{shade:"Caramel", size:"30ml"}`, SKU, barcode(s), retail price, wholesale price, reorder level, swatch hex or image, is_active)
- [ ] A product with no options has exactly one "default" variant
- [ ] Up to 2 option types per product (e.g. Shade, Size), matrix generator creates variants
- [ ] Variant is the unit that is stocked, sold, priced and reported on
- [ ] Multi-packs from suppliers (e.g. "Twin Pack 45G") are single variants

#### US-B3: Barcodes — manufacturer and in-store `[v1]`
**Description:** As staff, I want to scan the manufacturer barcode when creating a product, or generate one if it has none.
**Acceptance Criteria:**
- [ ] Variant can hold multiple barcodes (unique per org)
- [ ] Scanning an unknown barcode on the product form fills the barcode field
- [ ] "Generate barcode" creates an EAN-13 with in-store prefix `20`–`29` and valid check digit, unique per org
- [ ] Barcode never encodes price

#### US-B4: Supplier item code mapping and pack sizes `[v1]`
**Description:** As staff, I want each variant to remember the supplier's item code and pack size so receiving invoices is fast.
**Acceptance Criteria:**
- [ ] `variant_suppliers` (variant_id, supplier_id, supplier_item_code e.g. `FGWHDLIT01-40`, purchase UOM e.g. Carton, units_per_purchase_uom e.g. 48, last_cost)
- [ ] When receiving, typing/scanning supplier item code finds the variant

#### US-B5: Price levels and price-change approval `[v1]`
**Description:** As the owner, I want to set retail and wholesale prices, and have staff suggestions wait for my approval.
**Acceptance Criteria:**
- [ ] Each variant has `retail_price` and `wholesale_price` (integer cents)
- [ ] Owner edits apply immediately (logged)
- [ ] Staff edits create a `price_change_request` (variant, field, old, new, reason) with status pending
- [ ] Owner sees pending requests list with margin preview; approve applies, reject closes
- [ ] Cashiers never see cost or margin

#### US-B6: Till quick tiles `[v1]`
**Description:** As the owner, I want to pin popular or barcode-less products as tiles on the till home screen.
**Acceptance Criteria:**
- [ ] Owner arranges a grid of tiles (product, category shortcut, or custom label), drag to reorder
- [ ] Tiles show product image or colour swatch + name + retail price
- [ ] Tapping a product with multiple variants opens a variant picker with swatches

#### US-B7: Product import from CSV `[v1]`
**Description:** As the owner, I want to load my existing products from a spreadsheet so setup is fast.
**Acceptance Criteria:**
- [ ] CSV template download (product, brand, category, option1, option2, barcode, retail, wholesale, cost, opening qty)
- [ ] Preview with row-level validation errors before import
- [ ] Opening quantities post an opening-stock journal (Dr Inventory / Cr Opening Balance Equity)

### Epic C — Suppliers, Stock Intake and Stock Control

#### US-C1: Suppliers `[v1]`
**Description:** As staff, I want a supplier list with contact and payment details.
**Acceptance Criteria:**
- [ ] Supplier fields: name, KRA PIN, phone, email, address, paybill/bank details, payment terms (days)
- [ ] Supplier page shows balance owed, bills, payments

#### US-C2: Receive stock (supplier bill) `[v1]`
**Description:** As staff, I want to record a supplier invoice line by line so stock and money owed update together.
**Acceptance Criteria:**
- [ ] Header: supplier, supplier invoice no., invoice date, due date, attachment (photo of invoice)
- [ ] Lines: variant (search / scan barcode / supplier code), quantity in purchase UOM → converted to units, rate excl. VAT, VAT % (default 16%)
- [ ] "Rates include VAT" switch per bill. Landed line cost = rate × qty when inclusive, or rate × qty × (1 + VAT%) when exclusive; unit cost = line cost ÷ units; shown per line
- [ ] Save creates FIFO stock lots per variant and posts Dr Inventory / Cr Accounts Payable for the VAT-inclusive total
- [ ] Totals must match the paper invoice (e.g. 6,960.00) — shown prominently for checking
- [ ] Draft → Posted; posted bills can only be reversed (not edited)

#### US-C3: Pay suppliers `[v1]`
**Description:** As the owner, I want to record payments to suppliers against their bills.
**Acceptance Criteria:**
- [ ] Payment from Cash / M-Pesa / Bank account; allocate to one or more bills
- [ ] Posts Dr Accounts Payable / Cr chosen money account
- [ ] Bill status: Unpaid / Partial / Paid; AP aging report

#### US-C4: Stock adjustments `[v1]`
**Description:** As staff, I want to record damaged or missing stock with a reason.
**Acceptance Criteria:**
- [ ] Reasons: Damaged, Lost/Theft, Found, Owner use, Other (note required)
- [ ] Negative adjustments consume FIFO lots; post Dr Stock Loss expense / Cr Inventory (at FIFO cost)
- [ ] Adjustments above KES 1,000 value require owner approval

#### US-C5: Weekly stock take `[v1]`
**Description:** As staff, I want to count stock weekly (by category or all) and have differences posted automatically.
**Acceptance Criteria:**
- [ ] Start count session → choose scope (all / categories / brands) → system snapshots expected quantities
- [ ] Count by scanning (each scan +1) or typing quantity; can be done while till is in use (sales during count adjust the expected qty)
- [ ] Review screen: variance per variant, value at cost, total shrinkage
- [ ] Owner approves → adjustments post (Dr/Cr Stock Loss vs Inventory)
- [ ] Stock take history with shrinkage trend

#### US-C6: Low-stock alerts `[v1]`
**Description:** As the owner, I want to know when products fall below their reorder level.
**Acceptance Criteria:**
- [ ] Low-stock list (qty ≤ reorder level) on dashboard with supplier and last cost
- [ ] Included in owner daily SMS summary (count + top 5)

#### US-C7: Purchase orders `[v1.5]`
- [ ] PO to supplier from low-stock list; receive PO into a bill (partial receipts)

#### US-C8: Barcode label printing `[v1.5]`
- [ ] Print labels (name, variant, barcode, optional price) on a label printer (e.g. Xprinter XP-365B) via Tauri

### Epic D — Till (Point of Sale)

#### US-D1: Open shift `[v1]`
**Description:** As a cashier, I want to open my shift with a starting float so the cash-up is accurate.
**Acceptance Criteria:**
- [ ] Till blocks selling until a shift is open
- [ ] Enter opening float (by denomination or total); one open shift per register
- [ ] Shift records cashier, register, opened_at, float

#### US-D2: Build a cart `[v1]`
**Description:** As a cashier, I want to add items by scanning, searching or tapping tiles.
**Acceptance Criteria:**
- [ ] Scanner input (keyboard-wedge: fast keystrokes ending with Enter) adds the variant anywhere on the till screen without focusing a field
- [ ] Search box (always visible) matches name, brand, shade, SKU, barcode; results show swatch + stock qty
- [ ] Unknown barcode → toast "Not found — search or tell a staff member"; never silently fails
- [ ] Cart line: name, variant, qty stepper, unit price, line total; remove line
- [ ] Selling beyond stock on hand is allowed but flagged (warning, logged) — configurable to block
- [ ] Cart total in large tabular numerals

#### US-D3: Attach customer (mandatory) `[v1]`
**Description:** As the owner, I want every sale linked to a phone number so we can send receipts and promotions.
**Acceptance Criteria:**
- [ ] "Customer" slot at the top of the cart; Checkout disabled until a customer is attached
- [ ] Type phone (Kenyan formats `07…`, `01…`, `+254…` normalised to `2547…`/`2541…`); existing customer shows name, type, points, credit balance
- [ ] New number → quick-create (phone required, name optional, marketing consent checkbox default unticked)
- [ ] Customer type (Retail / Wholesale-Salon) sets the price level for the whole cart; switching customer re-prices the cart
- [ ] Marketing consent captured with timestamp (Kenya Data Protection Act)

#### US-D4: Discounts with approval `[v1]`
**Description:** As a cashier, I want to give small discounts myself and get owner approval for bigger ones.
**Acceptance Criteria:**
- [ ] Line discount or cart discount, as KES or %; reason required
- [ ] Total manual discount on a sale ≤ **KES 500** → applied immediately
- [ ] > KES 500 → owner enters their PIN on the till → applied, approver recorded
- [ ] `[v1.5]` If owner is away: "Request approval by phone" sends SMS/web link to owner; till shows waiting state; approve/reject updates the till in real time; request expires after 10 minutes
- [ ] Offer-engine prices (Epic H) are not manual discounts and don't count toward the limit

#### US-D5: Park and recall sales `[v1]`
**Description:** As a cashier, I want to park a sale while a customer keeps shopping and serve the next person.
**Acceptance Criteria:**
- [ ] Park current cart with label; list of parked carts; recall restores cart and customer
- [ ] Parked carts older than end of shift are flagged at cash-up

#### US-D6: Take payment `[v1]`
**Description:** As a cashier, I want to accept cash, M-Pesa, credit, loyalty points, or a mix.
**Acceptance Criteria:**
- [ ] Tenders: **Cash** (amount tendered → change shown large), **M-Pesa Till** (amount + M-Pesa code, 10-char alphanumeric, uppercase, **unique per org** — duplicate code is rejected), **Credit account** (only if customer has an approved credit account and the amount fits the available limit; else owner PIN override), **Loyalty points** (see Epic G)
- [ ] Split tender: any combination until balance = 0
- [ ] Completing the sale is a single server transaction: sale + lines + payments + stock (FIFO) + ledger + loyalty; all or nothing
- [ ] Each checkout carries a client-generated idempotency key; retrying after a network blip never double-posts
- [ ] If the server is unreachable, checkout shows "No connection — sale not saved, try again" and keeps the cart intact

#### US-D7: Receipt and drawer `[v1]`
**Description:** As a customer, I want a clear receipt on paper and by SMS.
**Acceptance Criteria:**
- [ ] On completion: drawer opens if any cash tender, receipt prints on XP-Q80 (80mm, 48 chars/line)
- [ ] Receipt: shop name/logo, address, phone, KRA PIN; receipt no. (`KF-000123`), date/time, cashier; lines (name, variant, qty × price, total); discounts; total; tenders & change; M-Pesa code; customer name (masked phone); points earned & balance; return policy line "Returns within 24 hrs, unopened items only"; footer message
- [ ] No VAT lines (TOT business)
- [ ] SMS receipt sent automatically: short summary + link to web receipt (`/r/{token}`)
- [ ] Reprint last receipt / any receipt from history (marked "REPRINT")

#### US-D8: Sales history on the till `[v1]`
**Description:** As a cashier, I want to find a past sale to reprint or return it.
**Acceptance Criteria:**
- [ ] Search by receipt no., phone, M-Pesa code, date; current shift by default

#### US-D9: Cash in / cash out `[v1]`
**Description:** As a cashier, I want to record cash taken out (e.g. paying a delivery) or put in during the shift.
**Acceptance Criteria:**
- [ ] Amount, reason category (Petty expense, Owner drawing, Float top-up, Other), note
- [ ] Posts: petty expense → Dr expense account / Cr Cash drawer; owner drawing → Dr Drawings / Cr Cash drawer
- [ ] Opens drawer; included in shift cash-up

### Epic E — Returns and Exchanges

#### US-E1: Return within policy `[v1]`
**Description:** As a cashier, I want to process returns only within the shop's policy.
**Acceptance Criteria:**
- [ ] Start from original receipt only (no receipt-less returns)
- [ ] Allowed only within **24 hours** of the original sale time; after that, owner PIN required
- [ ] Cashier must tick "Item is unopened and unused" for each returned line; otherwise the line cannot be returned
- [ ] Choose outcome: **Exchange** (default) or Refund (refund requires owner PIN)
- [ ] Refund goes back via original tender (cash / M-Pesa reversal recorded manually / credit account / points)
- [ ] Returned stock goes back into inventory at its original FIFO cost
- [ ] Ledger reversal: Dr Sales Returns / Cr tender; Dr Inventory / Cr COGS; loyalty points earned on returned items are reversed

#### US-E2: Exchange `[v1]`
**Description:** As a cashier, I want to swap an unopened item (e.g. wrong hair colour) for another in one step.
**Acceptance Criteria:**
- [ ] Exchange screen: returned items (credit) on left, new items on right; net difference shown
- [ ] Customer pays difference (any tender) or receives difference as refund (owner PIN) or credit note on account
- [ ] Single receipt shows both sides; linked to original sale

### Epic F — Shifts, Cash-up and M-Pesa Reconciliation

#### US-F1: X-report `[v1]`
- [ ] Mid-shift report: sales by tender, returns, discounts, cash in/out, expected cash — printable, doesn't close shift

#### US-F2: Close shift (Z-report) with blind count `[v1]`
**Description:** As a cashier, I want to count the drawer at shift end; as the owner, I want to see differences.
**Acceptance Criteria:**
- [ ] Cashier enters counted cash by denomination (KES 1000/500/200/100/50/40/20/10/5/1) **without seeing expected amount** (blind count)
- [ ] Cashier enters M-Pesa total from till statement/SMS (optional)
- [ ] System computes expected cash = float + cash sales − cash refunds ± cash in/out; variance shown after submit
- [ ] Variance posts Dr/Cr Cash Over/Short vs Cash drawer
- [ ] Cash to be banked / left as float recorded; transfer to "Cash at hand" or "Bank" posted
- [ ] Z-report printed and stored; shift locked

#### US-F3: M-Pesa till reconciliation `[v1]`
**Description:** As the owner, I want to check that every M-Pesa code typed by cashiers really came in.
**Acceptance Criteria:**
- [ ] Import M-Pesa till statement (CSV/Excel from M-Pesa portal or PDF → parse; port Zeno `mpesa-till-reconcile.ts`)
- [ ] Auto-match by code (and amount); statuses: Matched, Amount mismatch, Missing in statement, Not recorded in POS
- [ ] Unmatched items flagged on dashboard and linked to the cashier/shift

### Epic G — Customers, Credit and Loyalty

#### US-G1: Customer profiles `[v1]`
**Description:** As the owner, I want to see who my customers are and what they buy.
**Acceptance Criteria:**
- [ ] Fields: phone (unique per org, required), name, type (Retail / Wholesale-Salon), business name (salons), birthday (optional), marketing consent, notes
- [ ] Auto-derived: first/last visit, visit count, total spend, average basket, **top categories and brands** (last 90 days), points balance, credit balance
- [ ] Purchase history list with drill-down to receipts
- [ ] Customer list filterable by type, last visit, spend, category/brand bought (basis for targeting)

#### US-G2: Credit accounts `[v1]`
**Description:** As the owner, I want to let trusted customers (retail or salons) buy on credit up to a limit.
**Acceptance Criteria:**
- [ ] Owner enables credit on a customer with a limit (KES) and terms (days)
- [ ] Credit sale posts Dr Accounts Receivable / Cr Sales; blocked beyond available limit unless owner PIN
- [ ] Receive payment on account (cash / M-Pesa code / bank), allocated oldest-first or to chosen sales
- [ ] Customer statement (date range) printable & sendable by SMS link; AR aging (0–30/31–60/61–90/90+)
- [ ] Overdue credit customers shown on dashboard

#### US-G3: Suggested credit limit `[v1.5]`
**Description:** As the owner, I want the system to suggest a credit limit based on how often and how much a customer buys.
**Acceptance Criteria:**
- [ ] Suggestion = f(visit frequency, average monthly spend over 90 days, on-time repayment history); shown with explanation ("buys ~6×/month, avg KES 18,000/month → suggest KES 9,000")
- [ ] Owner accepts/edits; never auto-applied

#### US-G4: Loyalty points — earn `[v1]`
**Description:** As a retail customer, I want to earn points on every purchase.
**Acceptance Criteria:**
- [ ] Settings (org-level, editable by owner): earn rate (default **1 point per KES 10 spent**), point value (default **1 point = KES 0.10**, matching Carrefour MyCLUB), minimum redemption (default **KES 100 = 1,000 points**)
- [ ] Points earned on net paid amount (after discounts, excluding portion paid by points and by credit until settled — see open question)
- [ ] **Wholesale customers do not earn** unless a per-customer "earns points" override is set
- [ ] Points balance shown with KES value, like the MyCLUB card ("1,447.91 Points · 144.79 KES")
- [ ] Ledger: Dr Loyalty Expense / Cr Loyalty Liability at KES value of points issued

#### US-G5: Loyalty points — redeem `[v1]`
**Acceptance Criteria:**
- [ ] Redeem as a tender when balance ≥ minimum; any amount up to the cart total
- [ ] Ledger: Dr Loyalty Liability / Cr Sales-tender clearing (sale revenue unchanged)
- [ ] Points ledger per customer (earned, redeemed, reversed, adjusted, bonus) with running balance
- [ ] Manual points adjustment by owner only, with reason

### Epic H — Offers Engine (promotions like announcements)

#### US-H1: Create an offer `[v1]`
**Description:** As the owner, I want to schedule promotions on selected products for a period, the same way I'd post an announcement.
**Acceptance Criteria:**
- [ ] Offer fields: title, description, image (optional), start & end date-time, active toggle, audience (All / Retail / Wholesale), target (specific variants, products, brands, or categories)
- [ ] Offer types v1:
  - **Price off** — % or KES off each unit
  - **Fixed price** — special price per unit
  - **Bonus points** — e.g. "Get 1,000 points when you spend KES 1,000+ on Hair Care" (min spend on targets → fixed bonus points), or multiplier (2× points)
- [ ] Offers list with status: Scheduled / Live / Ended / Paused
- [ ] Zero offers is the default state; system works normally with none

#### US-H2: Apply offers at the till `[v1]`
**Acceptance Criteria:**
- [ ] Live offers apply automatically when a matching item is added; line shows original price struck through + offer name
- [ ] If multiple price offers match, the best price for the customer wins (no stacking in v1)
- [ ] Bonus points offers evaluated at checkout and shown before payment ("+1,000 bonus points")
- [ ] Offer discount posts to a separate "Promotional Discounts" contra-revenue account for reporting
- [ ] Offer performance report: units, revenue, discount cost, bonus points issued

#### US-H3: Announce offer to customers `[v1.5]`
- [ ] "Send to customers" → targeted SMS to consenting customers who bought the offer's category/brand in last N days

### Epic I — Messaging (SMS)

#### US-I1: SMS gateway and templates `[v1]`
**Description:** As the owner, I want automated SMS sent through my own gateway account.
**Acceptance Criteria:**
- [ ] Africa's Talking integration (port Zeno `src/lib/sms`); sender ID configurable; balance shown
- [ ] Editable templates with variables (`{name}`, `{total}`, `{points}`, `{balance}`, `{link}`)
- [ ] SMS log with status, cost, category; retries on failure
- [ ] Marketing categories only sent to customers with consent; every marketing SMS includes opt-out ("STOP to …")

#### US-I2: Transactional messages `[v1]`
- [ ] Sale receipt (+ points earned/balance)
- [ ] Return / exchange confirmation
- [ ] Credit sale confirmation + balance owed
- [ ] Credit payment received
- [ ] Credit due reminder (X days before due, on due date, overdue weekly)
- [ ] Points redeemed confirmation
- [ ] Owner daily summary (sales, margin, cash, M-Pesa, credit issued, low stock count, cash variance)
- [ ] Owner alerts: large discount approved, refund issued, cash variance > threshold, till not closed by 22:00

#### US-I3: Marketing automations `[v1.5]`
- [ ] Birthday offer
- [ ] Welcome message after first purchase
- [ ] Win-back (no visit in 30/60/90 days)
- [ ] "Running low?" replenishment nudge based on the customer's repeat interval for a product
- [ ] New stock arrived in a brand/category the customer buys
- [ ] Points milestone ("You have KES 150 to spend")
- [ ] Points expiry warning (if expiry is enabled later)
- [ ] Offer launch to targeted segment (US-H3)
- [ ] Monthly frequency cap per customer (default 4 marketing SMS)

### Epic J — Accounting (ported from Zeno)

#### US-J1: Chart of accounts for cosmetics retail `[v1]`
**Acceptance Criteria:**
- [ ] Seeded COA including: Cash Drawer, Cash at Hand, M-Pesa Till, Bank, Accounts Receivable, Inventory, Accounts Payable, Loyalty Liability, TOT Payable, Salaries Payable, Owner's Equity, Drawings, Opening Balance Equity, Sales – Retail, Sales – Wholesale, Sales Returns, Promotional Discounts, Manual Discounts, COGS, Stock Loss/Shrinkage, Cash Over/Short, Loyalty Expense, TOT Expense, SMS Expense, Rent, Salaries, Utilities, Transport, Other expenses
- [ ] Owner can add accounts; system accounts can't be deleted

#### US-J2: Posting engine `[v1]`
**Description:** As a developer, I need a single posting service so every business event creates a balanced journal.
**Acceptance Criteria:**
- [ ] Port Zeno `posting.ts`, `journalEntries`, `journalLines`, `ledger-integrity.ts`; only the posting service writes journals
- [ ] Posting rules implemented per §7.2 table; each journal links to its source document
- [ ] Every journal balances (debits = credits) — enforced in DB transaction
- [ ] Voids/returns post reversals; journals are never edited or deleted
- [ ] Period lock blocks postings dated in locked periods

#### US-J3: Expenses and money accounts `[v1]`
- [ ] Record expenses (rent, electricity, transport…) from Cash at Hand / M-Pesa / Bank with receipt photo
- [ ] Transfers between money accounts (e.g. banking the day's cash)
- [ ] Manual journals (accountant/owner), with balance check

#### US-J4: Turnover Tax `[v1]`
**Description:** As the owner, I want the monthly Turnover Tax computed from my sales.
**Acceptance Criteria:**
- [ ] TOT rate configurable (default **1.5%** of gross sales; confirm with accountant)
- [ ] Monthly TOT report: gross sales (net of returns) × rate = TOT due; due date 20th of following month
- [ ] "Post TOT for month" → Dr TOT Expense / Cr TOT Payable; recording payment → Dr TOT Payable / Cr Bank/M-Pesa
- [ ] Tax mode switch (`tot` / `vat` / `none`) exists at org level; VAT mode hidden in v1

### Epic K — Reports and Dashboard

#### US-K1: Owner dashboard `[v1]`
- [ ] Today: sales, receipts count, avg basket, gross margin %, cash expected, M-Pesa total, credit issued
- [ ] Week sparkline vs last week; top 5 products/brands today; low stock; pending approvals (prices, adjustments); unmatched M-Pesa codes; overdue credit customers
- [ ] Privacy blur toggle on headline figures (port Zeno `.stat-figure` blur)

#### US-K2: Financial reports `[v1]`
- [ ] P&L, Balance Sheet, Trial Balance, General Ledger by account, Cash Flow (from Zeno `reports.ts`), AR & AP aging, TOT report — date-range filter, CSV + PDF export

#### US-K3: Sales & retail reports `[v1]`
- [ ] Sales by day / hour-of-day / cashier / customer type / category / brand / product / variant (shade)
- [ ] Gross margin by product, brand, category
- [ ] Discounts report (manual vs offers, by cashier, approvals)
- [ ] Returns & exchanges report
- [ ] Shift / Z-report history with variances by cashier
- [ ] Stock valuation (FIFO) — must equal Inventory account balance
- [ ] Slow/dead stock (no sale in 30/60/90 days)
- [ ] Shrinkage from stock takes
- [ ] Loyalty: points issued/redeemed/outstanding liability; top loyalty customers
- [ ] Customer report: new vs returning, top customers, visit frequency

### Epic L — Payroll and Staff Time `[v1.5]`

#### US-L1: Payroll (port from Zeno)
- [ ] Employees, fixed net salary model as in Zeno, statutory rules (PAYE, SHIF, NSSF, Housing Levy), staff advances/loans, payroll runs, payslips, GL posting

#### US-L2: Optional clock-in at till
- [ ] Org setting "Enable clock-in" — **off by default**
- [ ] When on: staff clock in/out with PIN on the till; timesheet report; no effect on pay in v1.5

### Epic M — Platform readiness `[v2]`
- [ ] Self-service org signup/onboarding wizard, super-admin console (port Zeno `(admin)`), subscription billing
- [ ] Online store channel: product publishing, online orders reserving stock, shared customers by phone
- [ ] Customer loyalty card (web/app) with barcode like MyCLUB; scan card at till to attach customer
- [ ] Multi-register, multi-branch (branch = warehouse + cost center)
- [ ] VAT + eTIMS (OSCU/VSCU) enablement, M-Pesa STK push & C2B auto-match

---

## 6. Functional Requirements

**Tenancy & security**
- FR-1: Every business table must include `org_id`; all queries must be scoped by org through RLS and the server guard.
- FR-2: The system must enforce role permissions server-side; hiding a button is not sufficient.
- FR-3: All money values must be stored as integer cents (`bigint`); display as `KES 1,250.00`.
- FR-4: All timestamps stored UTC; displayed and "business day" computed in `Africa/Nairobi`.
- FR-5: Sensitive actions (§US-A3) must be written to the audit log in the same transaction as the action.

**Catalog & stock**
- FR-6: A variant is the unit of stock, price, sale and reporting; every product has ≥ 1 variant.
- FR-7: Barcodes must be unique per org; a variant may have multiple barcodes.
- FR-8: Generated barcodes must be valid EAN-13 with prefix 20–29.
- FR-9: Stock cost must use FIFO lots; landed cost includes non-claimable supplier VAT.
- FR-10: Stock quantity must never be edited directly — only via receipts, sales, returns, adjustments, stock takes, transfers.
- FR-11: Staff price changes must go through owner approval; owner changes apply immediately.

**Till**
- FR-12: A sale cannot be completed without an attached customer phone number.
- FR-13: The cart's price level is determined by the attached customer type (Retail/Wholesale).
- FR-14: Manual discounts totalling ≤ KES 500 per sale may be applied by a cashier; above that requires owner PIN (v1) or remote approval (v1.5).
- FR-15: M-Pesa codes must be unique per org and match `^[A-Z0-9]{10}$`.
- FR-16: Checkout must be atomic and idempotent (client idempotency key, unique constraint server-side).
- FR-17: If the server is unreachable, the till must not complete the sale and must preserve the cart.
- FR-18: Drawer opens only when a sale/refund/cash movement involves cash, or via "No sale" (logged, owner-visible).
- FR-19: Returns require the original receipt, must be within 24 hours (else owner PIN), and each line must be confirmed unopened.
- FR-20: Refunds (money back) require owner PIN; exchanges do not.

**Cash & reconciliation**
- FR-21: Shift close must use a blind count; variance posts to Cash Over/Short.
- FR-22: M-Pesa statement import must match on transaction code and flag amount mismatches.

**Customers, credit, loyalty, offers**
- FR-23: Phone numbers must be normalised to E.164 without `+` (`2547XXXXXXXX` / `2541XXXXXXXX`) and unique per org.
- FR-24: Credit sales must not exceed available credit (limit − outstanding) without owner PIN.
- FR-25: Loyalty earn/redeem parameters are org settings; wholesale customers don't earn unless overridden per customer.
- FR-26: Loyalty points issued post to Loyalty Liability; redemptions reduce it; reversals on returns.
- FR-27: Offers apply automatically within their date-time window; best single price offer wins; offers never stack in v1.
- FR-28: Marketing SMS only to consenting customers, with opt-out, and a per-customer monthly cap.

**Accounting**
- FR-29: Every financial event must post a balanced journal in the same DB transaction as the event.
- FR-30: Journals are append-only; corrections are reversals.
- FR-31: Posted periods can be locked; postings into locked periods are rejected.
- FR-32: Stock valuation report total must equal the Inventory GL balance (ledger integrity check runs nightly; mismatches alert owner).
- FR-33: TOT = rate × (gross sales − returns) per calendar month.

**Printing**
- FR-34: Receipts must print via ESC/POS on 80mm paper at 48 characters/line with a cut command.
- FR-35: A web receipt (`/r/{token}`) must be available for every sale, token unguessable (≥ 128-bit).

**Channel readiness**
- FR-36: Sales/orders carry `channel` (`pos` now; `online` later) and `register_id`.
- FR-37: Stock is tracked per `location_id` (one location in v1) to allow branches and an online fulfilment location later.

---

## 7. Technical Considerations

### 7.1 Stack & architecture

| Layer | Choice | Notes |
|---|---|---|
| Web app | Next.js 15 (App Router) + React 19 + TypeScript | Same as Zeno for easy module porting |
| Styling | Tailwind CSS v4 + Zeno tokens | §8 |
| DB | Supabase Postgres + Drizzle ORM | RLS for tenancy |
| Auth | Supabase Auth + till PIN (hashed, per user) | |
| Desktop | **Tauri 2** shell | Rust commands for USB ESC/POS printing & drawer kick; auto-update |
| SMS | Africa's Talking | Ported from Zeno |
| PDF | `@react-pdf/renderer` | Statements, reports, Z-reports |
| Hosting | Vercel (web) + Supabase | |
| Tests | Node test runner (as Zeno) for posting/tax/FIFO/loyalty/offers; Playwright smoke for till checkout | |

**Routes:** `/till/*` (full-screen POS, touch/keyboard-first) and `/(back-office)/*` (dashboard, catalog, stock, customers, offers, accounting, reports, settings) in one app. Till route is what the Tauri shell opens.

**Modules to port from Zeno** (copy, then adapt to `org_id` + retail): `posting.ts`, `money.ts`, `inventory.ts` (FIFO), `reports.ts`, `report-period.ts`, `ledger-integrity.ts`, `coa.ts`/`chart-of-accounts.ts`, `mpesa-till-reconcile.ts`, `sms/*`, `access.ts`/`guard.ts`, `audit.ts`, `payroll.ts` + `staff-loans.ts` (v1.5), `time-tracking.ts` (v1.5), `announcements.ts` (pattern for offers), `receipts/*`, `pdf/*`, `timezone.ts`, `tax.ts` (kept dormant for VAT mode).

**Not ported:** CRM pipeline, quotes, client portal, recurring invoices, knowledge base, campaigns (rebuilt as messaging), super-admin (v2).

### 7.2 Posting rules (non-VAT, TOT business)

| Event | Debit | Credit |
|---|---|---|
| Stock received (supplier bill) | Inventory (VAT-inclusive cost) | Accounts Payable |
| Supplier payment | Accounts Payable | Cash at Hand / M-Pesa / Bank |
| Sale — cash | Cash Drawer | Sales – Retail/Wholesale |
| Sale — M-Pesa | M-Pesa Till | Sales |
| Sale — credit | Accounts Receivable | Sales |
| Sale — points tender | Loyalty Liability | Sales |
| Cost of sale (every sale) | COGS | Inventory (FIFO cost) |
| Offer discount | Promotional Discounts (contra-revenue) | (reduces tender side; sales recorded gross) |
| Manual discount | Manual Discounts (contra-revenue) | (as above) |
| Points issued | Loyalty Expense | Loyalty Liability |
| Return / refund | Sales Returns | Cash / M-Pesa / AR / Loyalty Liability |
| Return restock | Inventory | COGS |
| Points reversed on return | Loyalty Liability | Loyalty Expense |
| Credit payment received | Cash / M-Pesa / Bank | Accounts Receivable |
| Cash out — petty expense | Expense account | Cash Drawer |
| Cash out — owner drawing | Drawings | Cash Drawer |
| Shift close — shortage | Cash Over/Short | Cash Drawer |
| Shift close — overage | Cash Drawer | Cash Over/Short |
| Cash banked / moved | Bank or Cash at Hand | Cash Drawer |
| Stock loss / stock-take shortfall | Stock Loss | Inventory |
| Stock-take surplus | Inventory | Stock Loss |
| Opening stock | Inventory | Opening Balance Equity |
| TOT for month | TOT Expense | TOT Payable |
| TOT paid | TOT Payable | Bank / M-Pesa |
| Payroll (v1.5) | Salaries expense | Salaries Payable / statutory payables |

### 7.3 Core data model (summary)

`orgs, users, memberships(role), role_permissions, registers, locations, shifts, cash_movements, categories, brands, products, variants, variant_barcodes, variant_suppliers, price_change_requests, suppliers, bills, bill_lines, supplier_payments, stock_lots, stock_movements, stock_takes, stock_take_lines, customers, customer_stats (materialised), credit_accounts, sales (channel, register_id, shift_id, customer_id, idempotency_key), sale_lines, sale_payments, returns, return_lines, loyalty_settings, loyalty_ledger, offers, offer_targets, approvals, sms_templates, sms_log, accounts, journal_entries, journal_lines, period_locks, expenses, money_transfers, mpesa_statement_lines, audit_log, settings`

### 7.4 Hardware integration
- **Scanner:** USB HID keyboard-wedge; detect scan as ≥ 6 chars within < 50 ms per keystroke ending in Enter; global listener on till screen.
- **Printer:** XP-Q80 via USB; ESC/POS byte builder in TS (text, bold, double-height total, alignment, logo raster, QR for web receipt, cut `GS V 1`), sent through Tauri `print_receipt`.
- **Drawer:** RJ11 on printer; pulse `ESC p 0 25 250` via Tauri `open_drawer`.

### 7.5 Performance
- Scan-to-cart line ≤ 150 ms (product/variant/barcode index cached client-side, refreshed on change via Supabase Realtime).
- Checkout round-trip ≤ 1.5 s on a normal connection.

---

## 8. Design Considerations

**Direction:** Zeno "Apple calm" tokens + Shopify POS layout + Kenfri Masterpiece red accent. Light mode only. No gradients; product imagery and colour swatches supply the beauty feel.

### 8.1 Tokens (ported from Zeno `globals.css`)

| Token | Value | Use |
|---|---|---|
| `--color-ink-900` | `#1d1d1f` | Primary text |
| `--color-ink-600` | `#515154` | Secondary text |
| `--color-ink-400` | `#86868b` | Tertiary / labels |
| `--color-ink-200` | `#d2d2d7` | Hairline borders |
| `--color-ink-100` | `#e8e8ed` | Card borders, dividers |
| `--color-ink-50` | `#f6f9fc` | App canvas (Stripe-style cool white) |
| `--color-good` | `#1f8a4c` | Paid, positive variance |
| `--color-warn` | `#b8860b` | Pending, low stock |
| `--color-bad` | `#c0392b` | Overdue, shortage, errors |
| `--color-brand` | **`#5A2132`** (Masterpiece red, ≈ 12:1 with white text) | Primary buttons, active nav text, links, focus rings |
| `--color-brand-tint` | **`#F4E6EA`** | Selected tiles, active rows, offer badges |
| `--radius-card` | `12px` | Cards |
| `--shadow-card` | `0 1px 2px rgba(0,0,0,.04), 0 4px 16px rgba(0,0,0,.04)` | Cards |
| Font | SF system stack (`-apple-system, … Inter, Roboto`) | All text; tabular numerals for money |
| Borders | `0.5px` hairlines | Structure without heaviness |
| Accent scale | `color-mix` 10/20/85/70% from `--color-brand` | Hover/active states (Zeno pattern) |

Role rules (from Zeno DESIGN.md): brand colour only for primary actions and active states — never headings or large backgrounds; red/amber/green reserved for money/stock semantics.

### 8.2 Till layout (Shopify POS-inspired)
- **Left (≈ 62%)**: search bar (always visible) → category chips → tile grid (product image or shade swatch, name, price; 2-level: product → variant sheet).
- **Right (≈ 38%)**: customer slot at top (phone, name, type badge, points, credit) → cart lines → offers applied → totals (large tabular total) → full-width **Checkout** button in brand colour.
- Top bar: shift status, cashier name (tap to switch user by PIN), connection indicator, parked carts count, More (X-report, cash in/out, returns, reprint, close shift).
- Touch targets ≥ 48 px; keyboard shortcuts: `F2` search, `F4` customer, `F8` park, `F12` checkout, `Esc` cancel.
- Payment sheet: tender buttons, numpad, quick-cash chips (exact, 500, 1,000, 2,000), change shown in large green numerals.

### 8.3 Back office
- Zeno sidebar pattern (translucent chrome, grouped nav): **Home · Sell (Sales, Returns, Shifts) · Products (Catalog, Stock, Stock takes, Suppliers) · Customers (Customers, Credit, Loyalty, Offers, Messages) · Money (Accounts, Expenses, Bills, M-Pesa reconcile) · Reports · Settings**.
- Plain-language labels with the accounting term as subtitle (Zeno rule).

### 8.4 Brand assets (to do before week 3)
- Kenfri Cosmetics wordmark + mark (generate via Higgsfield brand kit), receipt-safe monochrome version for thermal printing, app icon for the Tauri shell.

---

## 9. Non-Goals (v1)

- No VAT, eTIMS, or KRA control unit integration (TOT business).
- No offline selling.
- No M-Pesa STK push or automatic C2B payment matching at the till (manual code entry only).
- No batch/expiry tracking, no testers/samples tracking, no consignment stock.
- No customer-facing display.
- No dark mode.
- No online store, customer app/loyalty card, or public API (architecture only).
- No multi-branch, multi-register, or stock transfers UI.
- No gift cards or layaway (v2 candidates).
- No stacking of multiple promotions on one item.
- No quotes, CRM pipeline, or client portal.
- Payroll, clock-in, marketing automations, remote approval, POs, label printing → v1.5.

---

## 10. Success Metrics

- Median checkout time (first scan → receipt printed) ≤ 30 s for ≤ 3 items.
- 100% of sales have a customer phone; ≥ 60% of retail customers opt in to marketing within 3 months.
- Trial Balance balanced and Inventory GL = FIFO valuation every night (ledger integrity check: 0 findings).
- Daily cash variance within ± KES 100 on ≥ 90% of shifts after the first month.
- 100% of M-Pesa codes reconciled monthly; unmatched < 1%.
- Owner closes the month (TOT figure + P&L) in < 15 minutes.
- Repeat-customer rate and average basket tracked from month 1 as baseline for promotions.

---

## 11. Delivery Plan (v1, ~4 weeks)

| Week | Deliverables |
|---|---|
| 1 | Repo, tenancy + RLS, auth/roles/PIN, tokens & components, COA + posting engine + FIFO ported with tests, catalog (categories, brands, products/variants, barcodes), CSV import |
| 2 | Suppliers, stock receiving (landed cost), supplier payments, adjustments, stock take; till shell (Tauri), cart, scanning, customer attach, checkout (cash/M-Pesa/credit), receipts + drawer |
| 3 | Shifts/X/Z/blind count, cash in/out, returns & exchanges, discounts + owner PIN, park/recall, loyalty earn/redeem, offers engine, SMS receipts/transactional, credit accounts + statements |
| 4 | Dashboard, financial + retail reports, TOT, M-Pesa reconciliation import, expenses/transfers, period lock, ledger integrity job, brand assets, data load of real catalog, UAT at the shop, fixes |

---

## 12. Open Questions

1. **Loyalty earn rate:** Owner said "same as Carrefour." Screenshot confirms point value (1 pt = KES 0.10); Carrefour's public earn rate is unclear (2019 press: 2.5 pts per KES 100). Default set to **1 pt per KES 10 (1% back)** — confirm with owner.
2. **"Minimum 100 KES":** interpreted as minimum **redemption** of KES 100 (1,000 points). Or is it minimum purchase to earn points? Confirm.
3. Do credit (on-account) sales earn points at sale time or only when paid?
4. Do points expire (e.g. 12 months of inactivity)?
5. Variant structure — pending the larger multi-item supplier invoice (shades for foundations/hair colour; sizes). Confirm max 2 option types is enough.
6. TOT rate and filing: confirm 1.5% and that the owner files monthly on iTax.
7. Should selling below stock-on-hand be blocked or only warned?
8. Owner remote approval channel for v1.5: SMS link vs WhatsApp vs owner mobile web app?
9. Opening balances: existing cash, M-Pesa, supplier debts and customer credit balances at go-live date.
10. Does the shop need a "No sale" drawer open button at all?
11. Receipt footer text, SMS sender ID (e.g. `KENFRI`) — needs Africa's Talking sender ID registration (takes days; start early).
