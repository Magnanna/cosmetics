CREATE TABLE "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"date" text NOT NULL,
	"account_id" integer NOT NULL,
	"amount_cents" bigint NOT NULL,
	"paid_from" text NOT NULL,
	"description" text NOT NULL,
	"reference" text,
	"journal_entry_id" integer,
	"member_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "money_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"date" text NOT NULL,
	"from_code" text NOT NULL,
	"to_code" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"fee_cents" bigint DEFAULT 0 NOT NULL,
	"note" text,
	"journal_entry_id" integer,
	"member_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mpesa_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"file_name" text NOT NULL,
	"row_count" integer NOT NULL,
	"from_date" text,
	"to_date" text,
	"member_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mpesa_statement_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"import_id" integer NOT NULL,
	"code" text NOT NULL,
	"completed_at" text NOT NULL,
	"details" text,
	"paid_in_cents" bigint DEFAULT 0 NOT NULL,
	"withdrawn_cents" bigint DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"sale_id" integer,
	"customer_payment_id" integer,
	"pos_amount_cents" bigint
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "money_transfers" ADD CONSTRAINT "money_transfers_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpesa_imports" ADD CONSTRAINT "mpesa_imports_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpesa_statement_lines" ADD CONSTRAINT "mpesa_statement_lines_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mpesa_statement_lines" ADD CONSTRAINT "mpesa_statement_lines_import_id_mpesa_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."mpesa_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_expenses_org_date" ON "expenses" USING btree ("org_id","date");--> statement-breakpoint
CREATE INDEX "idx_transfers_org_date" ON "money_transfers" USING btree ("org_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_mpesa_lines_org_code" ON "mpesa_statement_lines" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "idx_mpesa_lines_import" ON "mpesa_statement_lines" USING btree ("import_id");