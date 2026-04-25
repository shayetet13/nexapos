-- Migration: 0020_add_shop_status
-- Adds is_active, is_banned, ban_reason columns to shops table
-- is_active  = false → shop suspended temporarily (dev admin action)
-- is_banned  = true  → shop permanently banned (shown ban page)
-- ban_reason = text shown to shop owner explaining the ban/suspension

ALTER TABLE shops
  ADD COLUMN IF NOT EXISTS is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS is_banned   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ban_reason  TEXT;

-- Index for efficient filtering of active/banned shops in dev dashboard
CREATE INDEX IF NOT EXISTS idx_shops_is_active  ON shops (is_active);
CREATE INDEX IF NOT EXISTS idx_shops_is_banned  ON shops (is_banned);
