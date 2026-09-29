CREATE TABLE "bill_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"bill_id" integer NOT NULL,
	"variant_id" integer NOT NULL,
	"supplier_item_code" text,
	"qty" integer NOT NULL,
	"units_per_uom" integer DEFAULT 1 NOT NULL,
	"rate_cents" bigint NOT NULL,
	"units" integer NOT NULL,
	"total_cents" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"supplier_invoice_no" text NOT NULL,
	"invoice_date" text NOT NULL,
	"due_date" text NOT NULL,
	"rates_include_vat" boolean DEFAULT true NOT NULL,
	"vat_bp" integer DEFAULT 1600 NOT NULL,
	"net_cents" bigint NOT NULL,
	"vat_cents" bigint NOT NULL,
	"total_cents" bigint NOT NULL,
	"paid_cents" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"journal_entry_id" integer,
	"notes" text,
	"member_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"shift_id" integer NOT NULL,
	"direction" text NOT NULL,
	"reason" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"note" text,
	"journal_entry_id" integer,
	"member_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"org_id" integer NOT NULL,
	"name" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"sale_id" integer NOT NULL,
	"variant_id" integer NOT NULL,
	"description" text NOT NULL,
	"qty" integer NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"manual_discount_cents" bigint DEFAULT 0 NOT NULL,
	"promo_discount_cents" bigint DEFAULT 0 NOT NULL,
	"line_total_cents" bigint NOT NULL,
	"cost_cents" bigint NOT NULL,
	"returned_qty" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"sale_id" integer NOT NULL,
	"method" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"tendered_cents" bigint,
	"change_cents" bigint,
	"mpesa_code" text
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"receipt_no" text NOT NULL,
	"receipt_token" text NOT NULL,
	"channel" text DEFAULT 'pos' NOT NULL,
	"register_id" integer,
	"shift_id" integer,
	"member_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"price_level" text NOT NULL,
	"business_date" text NOT NULL,
	"gross_cents" bigint NOT NULL,
	"manual_discount_cents" bigint DEFAULT 0 NOT NULL,
	"promo_discount_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint NOT NULL,
	"cost_cents" bigint NOT NULL,
	"points_earned_centipoints" bigint DEFAULT 0 NOT NULL,
	"discount_approved_by" integer,
	"status" text DEFAULT 'completed' NOT NULL,
	"idempotency_key" text NOT NULL,
	"journal_entry_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"register_id" integer NOT NULL,
	"opened_by" integer NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opening_float_cents" bigint NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_by" integer,
	"closed_at" timestamp with time zone,
	"counted_cash_cents" bigint,
	"expected_cash_cents" bigint,
	"variance_cents" bigint,
	"z_report" jsonb
);
--> statement-breakpoint
CREATE TABLE "stock_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"variant_id" integer NOT NULL,
	"qty_delta" integer NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"cost_cents" bigint DEFAULT 0 NOT NULL,
	"journal_entry_id" integer,
	"member_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_payment_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"payment_id" integer NOT NULL,
	"bill_id" integer NOT NULL,
	"amount_cents" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"date" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"journal_entry_id" integer,
	"member_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counters" ADD CONSTRAINT "counters_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_register_id_registers_id_fk" FOREIGN KEY ("register_id") REFERENCES "public"."registers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_register_id_registers_id_fk" FOREIGN KEY ("register_id") REFERENCES "public"."registers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_payment_id_supplier_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."supplier_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_bill_lines_bill" ON "bill_lines" USING btree ("bill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_bills_org_supplier_invoice" ON "bills" USING btree ("org_id","supplier_id","supplier_invoice_no");--> statement-breakpoint
CREATE INDEX "idx_bills_org_supplier" ON "bills" USING btree ("org_id","supplier_id");--> statement-breakpoint
CREATE INDEX "idx_cash_movements_shift" ON "cash_movements" USING btree ("shift_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_counters_org_name" ON "counters" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "idx_sale_lines_sale" ON "sale_lines" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "idx_sale_lines_org_variant" ON "sale_lines" USING btree ("org_id","variant_id");--> statement-breakpoint
CREATE INDEX "idx_sale_payments_sale" ON "sale_payments" USING btree ("sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sale_payments_org_mpesa" ON "sale_payments" USING btree ("org_id","mpesa_code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sales_org_receipt" ON "sales" USING btree ("org_id","receipt_no");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sales_org_idem" ON "sales" USING btree ("org_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sales_token" ON "sales" USING btree ("receipt_token");--> statement-breakpoint
CREATE INDEX "idx_sales_org_date" ON "sales" USING btree ("org_id","business_date");--> statement-breakpoint
CREATE INDEX "idx_sales_org_customer" ON "sales" USING btree ("org_id","customer_id");--> statement-breakpoint
CREATE INDEX "idx_sales_shift" ON "sales" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "idx_shifts_org_register" ON "shifts" USING btree ("org_id","register_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_shifts_one_open" ON "shifts" USING btree ("register_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "idx_adjustments_org" ON "stock_adjustments" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_spa_bill" ON "supplier_payment_allocations" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "idx_supplier_payments_org_supplier" ON "supplier_payments" USING btree ("org_id","supplier_id");