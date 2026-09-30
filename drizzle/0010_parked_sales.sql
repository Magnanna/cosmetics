CREATE TABLE "parked_sales" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"register_id" integer NOT NULL,
	"label" text NOT NULL,
	"customer_id" integer,
	"cart" jsonb NOT NULL,
	"member_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "parked_sales" ADD CONSTRAINT "parked_sales_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parked_sales" ADD CONSTRAINT "parked_sales_register_id_registers_id_fk" FOREIGN KEY ("register_id") REFERENCES "public"."registers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_parked_org_register" ON "parked_sales" USING btree ("org_id","register_id");