-- Migration: Make nickname globally unique (not per-shop)
-- Reason: Staff login no longer requires shopId in URL.
--         Global uniqueness guarantees a nickname maps to exactly one shop.

-- Drop the old per-shop unique index
DROP INDEX IF EXISTS user_shop_roles_shop_nickname_idx;

-- Create global unique index (partial — only rows with non-null nickname)
CREATE UNIQUE INDEX user_shop_roles_nickname_global_idx
  ON user_shop_roles (nickname)
  WHERE nickname IS NOT NULL;
