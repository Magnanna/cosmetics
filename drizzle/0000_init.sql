CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"subtype" text DEFAULT 'other' NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"member_id" integer,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"name" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"parent_id" integer,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"phone" text NOT NULL,
	"name" text,
	"type" text DEFAULT 'retail' NOT NULL,
	"business_name" text,
	"birthday" text,
	"marketing_consent" boolean DEFAULT false NOT NULL,
	"consent_at" timestamp with time zone,
	"earns_points_override" boolean,
	"points_balance_centipoints" bigint DEFAULT 0 NOT NULL,
	"credit_enabled" boolean DEFAULT false NOT NULL,
	"credit_limit_cents" bigint DEFAULT 0 NOT NULL,
	"credit_terms_days" integer DEFAULT 30 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"date" text NOT NULL,
	"memo" text,
	"source_type" text NOT NULL,
	"source_id" integer,
	"reversal_of_id" integer,
	"member_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"entry_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	"debit_cents" bigint DEFAULT 0 NOT NULL,
	"credit_cents" bigint DEFAULT 0 NOT NULL,
	"customer_id" integer,
	"supplier_id" integer,
	"memo" text
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'shop' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"role" text DEFAULT 'cashier' NOT NULL,
	"pin_hash" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"phone" text,
	"email" text,
	"address" text,
	"kra_pin" text,
	"logo_url" text,
	"brand_color" text DEFAULT '#9C6B55' NOT NULL,
	"timezone" text DEFAULT 'Africa/Nairobi' NOT NULL,
	"currency" text DEFAULT 'KES' NOT NULL,
	"tax_mode" text DEFAULT 'tot' NOT NULL,
	"tot_rate_bp" integer DEFAULT 150 NOT NULL,
	"lock_date" text,
	"cashier_discount_limit_cents" bigint DEFAULT 50000 NOT NULL,
	"return_window_hours" integer DEFAULT 24 NOT NULL,
	"allow_negative_stock" boolean DEFAULT true NOT NULL,
	"loyalty_earn_cents_per_point" integer DEFAULT 1000 NOT NULL,
	"loyalty_point_value_cents" integer DEFAULT 10 NOT NULL,
	"loyalty_min_redeem_cents" bigint DEFAULT 10000 NOT NULL,
	"clock_in_enabled" boolean DEFAULT false NOT NULL,
	"receipt_footer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orgs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "price_change_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"variant_id" integer NOT NULL,
	"field" text NOT NULL,
	"old_cents" bigint NOT NULL,
	"new_cents" bigint NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" integer NOT NULL,
	"decided_by" integer,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"name" text NOT NULL,
	"brand_id" integer,
	"category_id" integer,
	"description" text,
	"image_url" text,
	"option1_name" text,
	"option2_name" text,
	"archived" boolean DEFAULT false NOT NULL,
	"channels" text[] DEFAULT '{"pos"}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registers" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"location_id" integer NOT NULL,
	"name" text NOT NULL,
	"printer_name" text
);
--> statement-breakpoint
CREATE TABLE "stock_lots" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"variant_id" integer NOT NULL,
	"location_id" integer NOT NULL,
	"date" text NOT NULL,
	"qty" integer NOT NULL,
	"remaining_qty" integer NOT NULL,
	"total_cost_cents" bigint NOT NULL,
	"remaining_cost_cents" bigint NOT NULL,
	"source_type" text NOT NULL,
	"source_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"variant_id" integer NOT NULL,
	"location_id" integer NOT NULL,
	"qty_delta" integer NOT NULL,
	"cost_cents" bigint NOT NULL,
	"source_type" text NOT NULL,
	"source_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"name" text NOT NULL,
	"kra_pin" text,
	"phone" text,
	"email" text,
	"address" text,
	"payment_details" text,
	"terms_days" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variant_barcodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"variant_id" integer NOT NULL,
	"code" text NOT NULL,
	"source" text DEFAULT 'manufacturer' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variant_suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"variant_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"supplier_item_code" text,
	"purchase_uom" text DEFAULT 'PCS' NOT NULL,
	"units_per_uom" integer DEFAULT 1 NOT NULL,
	"last_cost_cents" bigint
);
--> statement-breakpoint
CREATE TABLE "variants" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"option1_value" text,
	"option2_value" text,
	"sku" text,
	"retail_price_cents" bigint DEFAULT 0 NOT NULL,
	"wholesale_price_cents" bigint DEFAULT 0 NOT NULL,
	"reorder_level" integer DEFAULT 0 NOT NULL,
	"swatch_hex" text,
	"image_url" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_change_requests" ADD CONSTRAINT "price_change_requests_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_change_requests" ADD CONSTRAINT "price_change_requests_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registers" ADD CONSTRAINT "registers_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registers" ADD CONSTRAINT "registers_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_barcodes" ADD CONSTRAINT "variant_barcodes_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_barcodes" ADD CONSTRAINT "variant_barcodes_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_suppliers" ADD CONSTRAINT "variant_suppliers_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_suppliers" ADD CONSTRAINT "variant_suppliers_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_suppliers" ADD CONSTRAINT "variant_suppliers_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_accounts_org_code" ON "accounts" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "idx_audit_org_time" ON "audit_log" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_brands_org_name" ON "brands" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "idx_categories_org" ON "categories" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_customers_org_phone" ON "customers" USING btree ("org_id","phone");--> statement-breakpoint
CREATE INDEX "idx_je_org_date" ON "journal_entries" USING btree ("org_id","date");--> statement-breakpoint
CREATE INDEX "idx_je_org_source" ON "journal_entries" USING btree ("org_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "idx_jl_org_entry" ON "journal_lines" USING btree ("org_id","entry_id");--> statement-breakpoint
CREATE INDEX "idx_jl_org_account" ON "journal_lines" USING btree ("org_id","account_id");--> statement-breakpoint
CREATE INDEX "idx_locations_org" ON "locations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_members_org" ON "members" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_pcr_org_status" ON "price_change_requests" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "idx_products_org" ON "products" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_products_org_brand" ON "products" USING btree ("org_id","brand_id");--> statement-breakpoint
CREATE INDEX "idx_registers_org" ON "registers" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "idx_lots_org_variant_loc" ON "stock_lots" USING btree ("org_id","variant_id","location_id");--> statement-breakpoint
CREATE INDEX "idx_moves_org_variant" ON "stock_movements" USING btree ("org_id","variant_id","location_id");--> statement-breakpoint
CREATE INDEX "idx_suppliers_org" ON "suppliers" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_barcodes_org_code" ON "variant_barcodes" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "idx_barcodes_variant" ON "variant_barcodes" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_vs_org_supplier_code" ON "variant_suppliers" USING btree ("org_id","supplier_id","supplier_item_code");--> statement-breakpoint
CREATE INDEX "idx_vs_variant" ON "variant_suppliers" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "idx_variants_org_product" ON "variants" USING btree ("org_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_variants_org_sku" ON "variants" USING btree ("org_id","sku");