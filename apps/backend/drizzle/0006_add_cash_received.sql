-- Migration: Add cash_received column to orders table
-- Used for tracking actual money received in money_mistake refund type
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS cash_received numeric(12,2);
