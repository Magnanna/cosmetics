CREATE TABLE "barcode_library" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text,
	"brand" text,
	"size" text,
	"image_url" text,
	"source" text NOT NULL,
	"looked_up_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photo_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "receiving_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"receiving_id" integer NOT NULL,
	"variant_id" integer NOT NULL,
	"qty" integer NOT NULL,
	"unit_rate_cents" bigint
);
--> statement-breakpoint
CREATE TABLE "receivings" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"supplier_id" integer NOT NULL,
	"supplier_invoice_no" text NOT NULL,
	"invoice_date" text NOT NULL,
	"due_date" text NOT NULL,
	"rates_include_vat" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"bill_id" integer,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "photo_tokens" ADD CONSTRAINT "photo_tokens_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_tokens" ADD CONSTRAINT "photo_tokens_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_lines" ADD CONSTRAINT "receiving_lines_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_lines" ADD CONSTRAINT "receiving_lines_receiving_id_receivings_id_fk" FOREIGN KEY ("receiving_id") REFERENCES "public"."receivings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_lines" ADD CONSTRAINT "receiving_lines_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivings" ADD CONSTRAINT "receivings_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receivings" ADD CONSTRAINT "receivings_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_receiving_lines_variant" ON "receiving_lines" USING btree ("receiving_id","variant_id");--> statement-breakpoint
CREATE INDEX "idx_receivings_org_status" ON "receivings" USING btree ("org_id","status");