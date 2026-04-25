-- Migration 0003: Catch-up schema changes + add note column to order_items
-- All statements use IF NOT EXISTS / DO...EXCEPTION blocks so this is safe to
-- run against a database that already has some of these objects from manual migrations.

CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid,
	"request_id" text NOT NULL,
	"session_id" text,
	"event" text NOT NULL,
	"user_id" uuid,
	"role" text,
	"ip_address" text,
	"user_agent" text,
	"method" text,
	"endpoint" text,
	"status" text DEFAULT 'success' NOT NULL,
	"execution_time" integer,
	"error_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consumables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit" text DEFAULT 'ชิ้น' NOT NULL,
	"quantity" numeric(12, 3) DEFAULT '0' NOT NULL,
	"min_qty" numeric(12, 3) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "email_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"otp_code" varchar(6) NOT NULL,
	"ref_code" varchar(8) NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"user_id" uuid NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_consumables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"consumable_id" uuid NOT NULL,
	"qty_per_unit" numeric(12, 3) DEFAULT '1' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qr_device_tokens" (
	"token" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qr_login_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"user_id" uuid,
	"shop_id" uuid,
	"branch_id" uuid,
	"login_token" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "staff_checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"branch_id" uuid,
	"checked_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_out_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "staff_qr_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"branch_id" uuid,
	"token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "withdrawal_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"staff_name" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "note" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "ref_code" varchar(10);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "refund_reason" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "refund_type" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "refunded_by" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "refund_otp" varchar(4);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "refund_otp_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cash_received" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "telegram_chat_id" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "phone" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "tax_id" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "address" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "opening_hours" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "working_days" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "google_review_url" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "is_banned" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "ban_reason" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "is_whitelisted" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user_shop_roles" ADD COLUMN IF NOT EXISTS "nickname" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_staff" boolean DEFAULT false;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "consumables" ADD CONSTRAINT "consumables_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "product_consumables" ADD CONSTRAINT "product_consumables_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "product_consumables" ADD CONSTRAINT "product_consumables_consumable_id_consumables_id_fk" FOREIGN KEY ("consumable_id") REFERENCES "public"."consumables"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "staff_checkins" ADD CONSTRAINT "staff_checkins_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "staff_checkins" ADD CONSTRAINT "staff_checkins_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "staff_qr_tokens" ADD CONSTRAINT "staff_qr_tokens_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "staff_qr_tokens" ADD CONSTRAINT "staff_qr_tokens_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_shop_id_idx" ON "audit_logs" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_user_id_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_event_idx" ON "audit_logs" USING btree ("event");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_status_idx" ON "audit_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_request_id_idx" ON "audit_logs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consumables_shop_id_idx" ON "consumables" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_otps_email_idx" ON "email_otps" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pwd_reset_email_idx" ON "password_reset_tokens" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_consumables_unique_idx" ON "product_consumables" USING btree ("product_id","consumable_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_consumables_product_idx" ON "product_consumables" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "qr_login_sessions_token_idx" ON "qr_login_sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_checkins_shop_date_idx" ON "staff_checkins" USING btree ("shop_id","checked_in_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_checkins_user_idx" ON "staff_checkins" USING btree ("user_id","checked_in_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "staff_qr_tokens_token_idx" ON "staff_qr_tokens" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "staff_qr_tokens_user_shop_idx" ON "staff_qr_tokens" USING btree ("user_id","shop_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_qr_tokens_shop_idx" ON "staff_qr_tokens" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "withdrawal_shop_status_idx" ON "withdrawal_requests" USING btree ("shop_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "withdrawal_branch_date_idx" ON "withdrawal_requests" USING btree ("branch_id","created_at");--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "orders" ADD CONSTRAINT "orders_refunded_by_users_id_fk" FOREIGN KEY ("refunded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "orders_ref_code_idx" ON "orders" USING btree ("ref_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "products_shop_active_idx" ON "products" USING btree ("shop_id","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_shop_roles_nickname_global_idx" ON "user_shop_roles" USING btree ("nickname");
