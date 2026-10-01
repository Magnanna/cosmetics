ALTER TABLE "orgs" ADD COLUMN "reorder_cover_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "lead_time_days" integer DEFAULT 7 NOT NULL;