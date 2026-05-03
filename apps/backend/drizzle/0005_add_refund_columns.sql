-- Migration: Add refund columns to orders table
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS refund_reason         text,
  ADD COLUMN IF NOT EXISTS refund_type           text CHECK (refund_type IN ('money_mistake', 'product_return')),
  ADD COLUMN IF NOT EXISTS refunded_at           timestamptz,
  ADD COLUMN IF NOT EXISTS refunded_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS refund_otp            varchar(4),
  ADD COLUMN IF NOT EXISTS refund_otp_expires_at timestamptz;
