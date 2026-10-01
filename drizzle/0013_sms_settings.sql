CREATE TABLE "sms_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"provider" text DEFAULT 'advanta' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"sender_id" text,
	"config_enc" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sms_settings" ADD CONSTRAINT "sms_settings_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sms_settings_org" ON "sms_settings" USING btree ("org_id");