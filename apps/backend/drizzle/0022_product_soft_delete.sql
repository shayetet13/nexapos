-- Add soft-delete support to products
-- Products with a sales history cannot be hard-deleted (FK restrict on order_items).
-- Setting deleted_at marks the product as removed while preserving all historical data.

ALTER TABLE "products" ADD COLUMN "deleted_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "products_shop_active_idx" ON "products" ("shop_id", "deleted_at");
