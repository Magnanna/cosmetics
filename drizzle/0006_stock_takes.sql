CREATE TABLE "stock_take_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"stock_take_id" integer NOT NULL,
	"variant_id" integer NOT NULL,
	"counted_qty" integer,
	"system_qty_at_count" integer,
	"counted_by" integer,
	"counted_at" timestamp with time zone,
	"adjusted_qty" integer,
	"adjusted_cost_cents" bigint
);
--> statement-breakpoint
CREATE TABLE "stock_takes" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"location_id" integer NOT NULL,
	"scope" jsonb NOT NULL,
	"scope_label" text NOT NULL,
	"status" text DEFAULT 'counting' NOT NULL,
	"started_by" integer NOT NULL,
	"submitted_by" integer,
	"submitted_at" timestamp with time zone,
	"decided_by" integer,
	"decided_at" timestamp with time zone,
	"variance_cost_cents" bigint,
	"journal_entry_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_take_lines" ADD CONSTRAINT "stock_take_lines_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_take_lines" ADD CONSTRAINT "stock_take_lines_stock_take_id_stock_takes_id_fk" FOREIGN KEY ("stock_take_id") REFERENCES "public"."stock_takes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_take_lines" ADD CONSTRAINT "stock_take_lines_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_takes" ADD CONSTRAINT "stock_takes_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_takes" ADD CONSTRAINT "stock_takes_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_stl_take_variant" ON "stock_take_lines" USING btree ("stock_take_id","variant_id");--> statement-breakpoint
CREATE INDEX "idx_stock_takes_org" ON "stock_takes" USING btree ("org_id","status");