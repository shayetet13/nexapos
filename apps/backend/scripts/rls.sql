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
ALTER TABLE dining_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE dining_sessions ENABLE ROW LEVEL SECURITY;

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

-- Dining tables: shop-scoped (same as products)
CREATE POLICY dining_tables_select_policy ON dining_tables
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_shop_roles usr
      WHERE usr.shop_id = dining_tables.shop_id
      AND usr.user_id = auth.uid()::uuid
    )
  );

CREATE POLICY dining_tables_insert_policy ON dining_tables
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_shop_roles usr
      WHERE usr.shop_id = dining_tables.shop_id
      AND usr.user_id = auth.uid()::uuid
    )
  );

CREATE POLICY dining_tables_update_policy ON dining_tables
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_shop_roles usr
      WHERE usr.shop_id = dining_tables.shop_id
      AND usr.user_id = auth.uid()::uuid
    )
  );

CREATE POLICY dining_tables_delete_policy ON dining_tables
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_shop_roles usr
      WHERE usr.shop_id = dining_tables.shop_id
      AND usr.user_id = auth.uid()::uuid
    )
  );

-- Dining sessions: shop-scoped
CREATE POLICY dining_sessions_select_policy ON dining_sessions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_shop_roles usr
      WHERE usr.shop_id = dining_sessions.shop_id
      AND usr.user_id = auth.uid()::uuid
    )
  );

CREATE POLICY dining_sessions_insert_policy ON dining_sessions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_shop_roles usr
      WHERE usr.shop_id = dining_sessions.shop_id
      AND usr.user_id = auth.uid()::uuid
    )
  );

CREATE POLICY dining_sessions_update_policy ON dining_sessions
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_shop_roles usr
      WHERE usr.shop_id = dining_sessions.shop_id
      AND usr.user_id = auth.uid()::uuid
    )
  );

CREATE POLICY dining_sessions_delete_policy ON dining_sessions
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_shop_roles usr
      WHERE usr.shop_id = dining_sessions.shop_id
      AND usr.user_id = auth.uid()::uuid
    )
  );

-- ─── Additional shop-scoped tables ─────────────────────────────────────────────

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE combos ENABLE ROW LEVEL SECURITY;
ALTER TABLE combo_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumables ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_consumables ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_sales_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_qr_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_checkins ENABLE ROW LEVEL SECURITY;

-- Helper macro (reused pattern): EXISTS (SELECT 1 FROM user_shop_roles WHERE shop_id=X AND user_id=auth.uid())

-- Customers: shop-scoped read/write
CREATE POLICY customers_select_policy ON customers FOR SELECT
  USING (EXISTS (SELECT 1 FROM user_shop_roles r WHERE r.shop_id = customers.shop_id AND r.user_id = auth.uid()::uuid));
CREATE POLICY customers_insert_policy ON customers FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM user_shop_roles r WHERE r.shop_id = customers.shop_id AND r.user_id = auth.uid()::uuid));
CREATE POLICY customers_update_policy ON customers FOR UPDATE
  USING (EXISTS (SELECT 1 FROM user_shop_roles r WHERE r.shop_id = customers.shop_id AND r.user_id = auth.uid()::uuid));
CREATE POLICY customers_delete_policy ON customers FOR DELETE
  USING (EXISTS (SELECT 1 FROM user_shop_roles r WHERE r.shop_id = customers.shop_id AND r.user_id = auth.uid()::uuid));

-- Promotions: shop-scoped
CREATE POLICY promotions_select_policy ON promotions FOR SELECT
  USING (EXISTS (SELECT 1 FROM user_shop_roles r WHERE r.shop_id = promotions.shop_id AND r.user_id = auth.uid()::uuid));
CREATE POLICY promotions_insert_policy ON promotions FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM user_shop_roles r WHERE r.shop_id = promotions.shop_id AND r.user_id = auth.uid()::uuid));
CREATE POLICY promotions_update_policy ON promotions FOR UPDATE
  USING (EXISTS (SELECT 1 FROM user_shop_roles r WHERE r.shop_id = promotions.shop_id AND r.user_id = auth.uid()::uuid));
CREATE POLICY promotions_delete_policy ON promotions FOR DELETE
  USING (EXISTS (SELECT 1 FROM user_shop_roles r WHERE r.shop_id = promotions.shop_id AND r.user_id = auth.uid()::uuid));

-- Combos: shop-scoped
CREATE POLICY combos_select_policy ON combos FOR SELECT
  USING (EXISTS (SELECT 1 FROM user_shop_roles r WHERE r.shop_id = combos.shop_id AND r.user_id = auth.uid()::uuid));
CREATE POLICY combos_insert_policy ON combos FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM user_shop_roles r WHERE r.shop_id = combos.shop_id AND r.user_id = auth.uid()::uuid));
CREATE POLICY combos_update_policy ON combos FOR UPDATE
  USING (EXISTS (SELECT 1 FROM user_shop_roles r WHERE r.shop_id = combos.shop_id AND r.user_id = auth.uid()::uuid));
CREATE POLICY combos_delete_policy ON combos FOR DELETE
  USING (EXISTS (SELECT 1 FROM user_shop_roles r WHERE r.shop_id = combos.shop_id AND r.user_id = auth.uid()::uuid));

-- Combo items: accessible if user can access the parent combo's shop
CREATE POLICY combo_items_select_policy ON combo_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM combos c JOIN user_shop_roles r ON r.shop_id = c.shop_id WHERE c.id = combo_items.combo_id AND r.user_id = auth.uid()::uuid));
CREATE POLICY combo_items_insert_policy ON combo_items FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM combos c JOIN user_shop_roles r ON r.shop_id = c.shop_id WHERE c.id = combo_items.combo_id AND r.user_id = auth.uid()::uuid));
CREATE POLICY combo_items_delete_policy ON combo_items FOR DELETE
  USING (EXISTS (SELECT 1 FROM combos c JOIN user_shop_roles r ON r.shop_id = c.shop_id WHERE c.id = combo_items.combo_id AND r.user_id = auth.uid()::uuid));

-- Shop units: shop-scoped
CREATE POLICY shop_units_select_policy ON shop_units FOR SELECT
  USING (EXISTS (SELECT 1 FROM user_shop_roles r WHERE r.shop_id = shop_units.shop_id AND r.user_id = auth.uid()::uuid));
CREATE POLICY shop_units_insert_policy ON shop_units FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM user_shop_roles r WHERE r.shop_id = shop_units.shop_id AND r.user_id = auth.uid()::uuid));
CREATE POLICY shop_units_delete_policy ON shop_units FOR DELETE
  USING (EXISTS (SELECT 1 FROM user_shop_roles r WHERE r.shop_id = shop_units.shop_id AND r.user_id = auth.uid()::uuid));

-- Consumables: shop-scoped
CREATE POLICY consumables_select_policy ON consumables FOR SELECT
  USING (EXISTS (SELECT 1 FROM user_shop_roles r WHERE r.shop_id = consumables.shop_id AND r.user_id = auth.uid()::uuid));
CREATE POLICY consumables_insert_policy ON consumables FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM user_shop_roles r WHERE r.shop_id = consumables.shop_id AND r.user_id = auth.uid()::uuid));
CREATE POLICY consumables_update_policy ON consumables FOR UPDATE
  USING (EXISTS (SELECT 1 FROM user_shop_roles r WHERE r.shop_id = consumables.shop_id AND r.user_id = auth.uid()::uuid));
CREATE POLICY consumables_delete_policy ON consumables FOR DELETE
  USING (EXISTS (SELECT 1 FROM user_shop_roles r WHERE r.shop_id = consumables.shop_id AND r.user_id = auth.uid()::uuid));

-- Product consumables (BOM): via product's shop
CREATE POLICY product_consumables_select_policy ON product_consumables FOR SELECT
  USING (EXISTS (SELECT 1 FROM products p JOIN user_shop_roles r ON r.shop_id = p.shop_id WHERE p.id = product_consumables.product_id AND r.user_id = auth.uid()::uuid));
CREATE POLICY product_consumables_insert_policy ON product_consumables FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM products p JOIN user_shop_roles r ON r.shop_id = p.shop_id WHERE p.id = product_consumables.product_id AND r.user_id = auth.uid()::uuid));
CREATE POLICY product_consumables_delete_policy ON product_consumables FOR DELETE
  USING (EXISTS (SELECT 1 FROM products p JOIN user_shop_roles r ON r.shop_id = p.shop_id WHERE p.id = product_consumables.product_id AND r.user_id = auth.uid()::uuid));

-- Stock transactions: shop-scoped, insert-only from app layer
CREATE POLICY stock_transactions_select_policy ON stock_transactions FOR SELECT
  USING (EXISTS (SELECT 1 FROM user_shop_roles r WHERE r.shop_id = stock_transactions.shop_id AND r.user_id = auth.uid()::uuid));
CREATE POLICY stock_transactions_insert_policy ON stock_transactions FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM user_shop_roles r WHERE r.shop_id = stock_transactions.shop_id AND r.user_id = auth.uid()::uuid));

-- Shop notifications: shop-scoped read/update (mark read), insert by app
CREATE POLICY shop_notifications_select_policy ON shop_notifications FOR SELECT
  USING (EXISTS (SELECT 1 FROM user_shop_roles r WHERE r.shop_id = shop_notifications.shop_id AND r.user_id = auth.uid()::uuid));
CREATE POLICY shop_notifications_update_policy ON shop_notifications FOR UPDATE
  USING (EXISTS (SELECT 1 FROM user_shop_roles r WHERE r.shop_id = shop_notifications.shop_id AND r.user_id = auth.uid()::uuid));
CREATE POLICY shop_notifications_insert_policy ON shop_notifications FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM user_shop_roles r WHERE r.shop_id = shop_notifications.shop_id AND r.user_id = auth.uid()::uuid));

-- Sales snapshots: shop-scoped, read-only for members (written by cron via service role)
CREATE POLICY shop_sales_snapshots_select_policy ON shop_sales_snapshots FOR SELECT
  USING (EXISTS (SELECT 1 FROM user_shop_roles r WHERE r.shop_id = shop_sales_snapshots.shop_id AND r.user_id = auth.uid()::uuid));

-- Withdrawal requests: shop-scoped
CREATE POLICY withdrawal_requests_select_policy ON withdrawal_requests FOR SELECT
  USING (EXISTS (SELECT 1 FROM user_shop_roles r WHERE r.shop_id = withdrawal_requests.shop_id AND r.user_id = auth.uid()::uuid));
CREATE POLICY withdrawal_requests_insert_policy ON withdrawal_requests FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM user_shop_roles r WHERE r.shop_id = withdrawal_requests.shop_id AND r.user_id = auth.uid()::uuid));
CREATE POLICY withdrawal_requests_update_policy ON withdrawal_requests FOR UPDATE
  USING (EXISTS (SELECT 1 FROM user_shop_roles r WHERE r.shop_id = withdrawal_requests.shop_id AND r.user_id = auth.uid()::uuid));

-- Staff QR tokens: user can only see their own tokens
CREATE POLICY staff_qr_tokens_select_policy ON staff_qr_tokens FOR SELECT
  USING (user_id = auth.uid()::uuid);
CREATE POLICY staff_qr_tokens_insert_policy ON staff_qr_tokens FOR INSERT
  WITH CHECK (user_id = auth.uid()::uuid);
CREATE POLICY staff_qr_tokens_delete_policy ON staff_qr_tokens FOR DELETE
  USING (user_id = auth.uid()::uuid);

-- Staff checkins: user can only see their own checkins
CREATE POLICY staff_checkins_select_policy ON staff_checkins FOR SELECT
  USING (user_id = auth.uid()::uuid OR EXISTS (SELECT 1 FROM user_shop_roles r WHERE r.shop_id = staff_checkins.shop_id AND r.user_id = auth.uid()::uuid AND r.role IN ('owner','manager')));
CREATE POLICY staff_checkins_insert_policy ON staff_checkins FOR INSERT
  WITH CHECK (user_id = auth.uid()::uuid);
