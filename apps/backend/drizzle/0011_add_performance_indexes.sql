-- Performance indexes — Phase 2 migration
-- Run this directly via Supabase SQL editor or psql
-- All indexes use IF NOT EXISTS to be safe to re-run

-- branches: lookup by shop
CREATE INDEX IF NOT EXISTS "branches_shop_id_idx"
  ON "branches" USING btree ("shop_id");

-- products: lookup by shop (all products)
CREATE INDEX IF NOT EXISTS "products_shop_id_idx"
  ON "products" USING btree ("shop_id");

-- products: POS filter (show_on_pos = true per shop)
CREATE INDEX IF NOT EXISTS "products_shop_pos_idx"
  ON "products" USING btree ("shop_id", "show_on_pos");

-- customers: name search per shop
CREATE INDEX IF NOT EXISTS "customers_name_search_idx"
  ON "customers" USING btree ("shop_id", "name");

-- order_items: fetch items for an order
CREATE INDEX IF NOT EXISTS "order_items_order_id_idx"
  ON "order_items" USING btree ("order_id");

-- orders: unique order number per shop
CREATE UNIQUE INDEX IF NOT EXISTS "orders_shop_order_number_idx"
  ON "orders" USING btree ("shop_id", "order_number");

-- stock_transactions: history lookup per shop+branch+date
CREATE INDEX IF NOT EXISTS "stock_tx_shop_branch_idx"
  ON "stock_transactions" USING btree ("shop_id", "branch_id", "created_at");
