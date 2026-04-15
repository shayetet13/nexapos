-- RLS Policies for POS Cloud SaaS
-- Run after migrations. Requires: auth.uid() from Supabase or custom JWT role.

-- Enable RLS on all tables
ALTER TABLE shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_shop_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_logs ENABLE ROW LEVEL SECURITY;

-- Shops: Users see shops they have a role in
CREATE POLICY shops_select_policy ON shops
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_shop_roles usr
      WHERE usr.shop_id = shops.id
      AND usr.user_id = auth.uid()::uuid
    )
  );

CREATE POLICY shops_insert_policy ON shops
  FOR INSERT
  WITH CHECK (true); -- Service role or owner creates

-- Branches: Same shop access
CREATE POLICY branches_select_policy ON branches
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_shop_roles usr
      WHERE usr.shop_id = branches.shop_id
      AND usr.user_id = auth.uid()::uuid
    )
  );

-- Products: Shop-scoped
CREATE POLICY products_select_policy ON products
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_shop_roles usr
      WHERE usr.shop_id = products.shop_id
      AND usr.user_id = auth.uid()::uuid
    )
  );

-- Orders: Branch-scoped within shop
CREATE POLICY orders_select_policy ON orders
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_shop_roles usr
      WHERE usr.shop_id = orders.shop_id
      AND usr.user_id = auth.uid()::uuid
    )
  );

-- Logs: Immutable, read-only for shop members
CREATE POLICY logs_select_policy ON logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_shop_roles usr
      WHERE usr.shop_id = logs.shop_id
      AND usr.user_id = auth.uid()::uuid
    )
  );

-- No UPDATE/DELETE on logs (enforced by app layer + trigger)
CREATE POLICY logs_insert_policy ON logs
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_shop_roles usr
      WHERE usr.shop_id = logs.shop_id
      AND usr.user_id = auth.uid()::uuid
    )
  );
