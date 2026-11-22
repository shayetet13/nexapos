-- ลบ Demo Shop และข้อมูลที่เกี่ยวข้อง (รันใน Supabase SQL Editor)
-- ลำดับต้องถูกต้องเพราะ Foreign Key

-- 1. ลบ order_items ก่อน (อ้างอิง orders)
DELETE FROM order_items
WHERE order_id IN (SELECT id FROM orders WHERE shop_id IN (SELECT id FROM shops WHERE name = 'Demo Shop'));

-- 2. ลบ orders
DELETE FROM orders
WHERE shop_id IN (SELECT id FROM shops WHERE name = 'Demo Shop');

-- 3. ลบ logs, events, subscriptions, payment_logs
DELETE FROM logs WHERE shop_id IN (SELECT id FROM shops WHERE name = 'Demo Shop');
DELETE FROM events WHERE shop_id IN (SELECT id FROM shops WHERE name = 'Demo Shop');
DELETE FROM subscriptions WHERE shop_id IN (SELECT id FROM shops WHERE name = 'Demo Shop');
DELETE FROM payment_logs WHERE shop_id IN (SELECT id FROM shops WHERE name = 'Demo Shop');

-- 4. ลบ user_shop_roles
DELETE FROM user_shop_roles
WHERE shop_id IN (SELECT id FROM shops WHERE name = 'Demo Shop');

-- 5. ลบ branch_stock
DELETE FROM branch_stock
WHERE branch_id IN (SELECT id FROM branches WHERE shop_id IN (SELECT id FROM shops WHERE name = 'Demo Shop'));

-- 6. ลบ branches
DELETE FROM branches
WHERE shop_id IN (SELECT id FROM shops WHERE name = 'Demo Shop');

-- 7. ลบ products
DELETE FROM products
WHERE shop_id IN (SELECT id FROM shops WHERE name = 'Demo Shop');

-- 8. ลบ shops
DELETE FROM shops WHERE name = 'Demo Shop';
