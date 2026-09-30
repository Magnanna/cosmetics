ALTER TABLE "customers" ADD COLUMN "card_token" text;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "poster_backdrops" jsonb;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "image_original_url" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "image_cutout_url" text;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_customers_card_token" ON "customers" USING btree ("card_token");