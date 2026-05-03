-- Shop mode + dining tables / sessions + orders.dining_session_id
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "shop_mode" text DEFAULT 'retail' NOT NULL;
ALTER TABLE "shops" ADD CONSTRAINT "shops_shop_mode_check" CHECK ("shop_mode" IN ('retail', 'full_service_restaurant'));

CREATE TABLE IF NOT EXISTS "dining_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"label" text NOT NULL,
	"capacity" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "dining_tables_shop_branch_label_idx" ON "dining_tables" ("shop_id","branch_id","label");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dining_tables_shop_id_idx" ON "dining_tables" ("shop_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "dining_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"dining_table_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"guest_count" integer,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dining_sessions" ADD CONSTRAINT "dining_sessions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dining_sessions" ADD CONSTRAINT "dining_sessions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dining_sessions" ADD CONSTRAINT "dining_sessions_dining_table_id_dining_tables_id_fk" FOREIGN KEY ("dining_table_id") REFERENCES "public"."dining_tables"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "dining_sessions" ADD CONSTRAINT "dining_sessions_status_check" CHECK ("status" IN ('open', 'closed', 'void'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dining_sessions_shop_status_idx" ON "dining_sessions" ("shop_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dining_sessions_table_status_idx" ON "dining_sessions" ("dining_table_id","status");
--> statement-breakpoint

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "dining_session_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "orders" ADD CONSTRAINT "orders_dining_session_id_dining_sessions_id_fk" FOREIGN KEY ("dining_session_id") REFERENCES "public"."dining_sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_dining_session_id_idx" ON "orders" ("dining_session_id");
