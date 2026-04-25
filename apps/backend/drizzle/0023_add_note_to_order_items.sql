-- Add note column to order_items
-- This allows cashiers to attach per-item notes (e.g. "หวานน้อย", "ไม่ใส่น้ำแข็ง")
-- and have them appear on the receipt.
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "note" text;
