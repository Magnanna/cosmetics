CREATE TABLE "customer_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"date" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"method" text NOT NULL,
	"mpesa_code" text,
	"reference" text,
	"shift_id" integer,
	"journal_entry_id" integer,
	"member_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loyalty_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"kind" text NOT NULL,
	"points_centipoints" bigint NOT NULL,
	"value_cents" bigint NOT NULL,
	"sale_id" integer,
	"return_id" integer,
	"note" text,
	"member_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offer_targets" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"offer_id" integer NOT NULL,
	"kind" text NOT NULL,
	"target_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"value" integer NOT NULL,
	"min_spend_cents" bigint DEFAULT 0 NOT NULL,
	"audience" text DEFAULT 'all' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_return_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"return_id" integer NOT NULL,
	"sale_line_id" integer NOT NULL,
	"variant_id" integer NOT NULL,
	"qty" integer NOT NULL,
	"amount_cents" bigint NOT NULL,
	"cost_cents" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_returns" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"return_no" text NOT NULL,
	"sale_id" integer NOT NULL,
	"shift_id" integer,
	"customer_id" integer NOT NULL,
	"kind" text NOT NULL,
	"refund_method" text,
	"total_cents" bigint NOT NULL,
	"cost_cents" bigint NOT NULL,
	"credit_left_cents" bigint DEFAULT 0 NOT NULL,
	"approved_by" integer,
	"member_id" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"journal_entry_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"customer_id" integer,
	"to" text NOT NULL,
	"category" text NOT NULL,
	"body" text NOT NULL,
	"status" text NOT NULL,
	"provider_id" text,
	"cost_text" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "offer_id" integer;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD COLUMN "return_id" integer;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD COLUMN "points_spent_centipoints" bigint;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_targets" ADD CONSTRAINT "offer_targets_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_targets" ADD CONSTRAINT "offer_targets_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_return_id_sale_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."sale_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_sale_line_id_sale_lines_id_fk" FOREIGN KEY ("sale_line_id") REFERENCES "public"."sale_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_log" ADD CONSTRAINT "sms_log_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_customer_payments_customer" ON "customer_payments" USING btree ("org_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_customer_payments_mpesa" ON "customer_payments" USING btree ("org_id","mpesa_code");--> statement-breakpoint
CREATE INDEX "idx_loyalty_customer" ON "loyalty_ledger" USING btree ("org_id","customer_id");--> statement-breakpoint
CREATE INDEX "idx_offer_targets_offer" ON "offer_targets" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "idx_offers_org_window" ON "offers" USING btree ("org_id","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "idx_return_lines_return" ON "sale_return_lines" USING btree ("return_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_returns_org_no" ON "sale_returns" USING btree ("org_id","return_no");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_returns_org_idem" ON "sale_returns" USING btree ("org_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_returns_sale" ON "sale_returns" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "idx_sms_org_time" ON "sms_log" USING btree ("org_id","created_at");