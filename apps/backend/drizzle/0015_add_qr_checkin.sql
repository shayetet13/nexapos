-- Migration 0015: Staff QR tokens + Check-in log

-- Staff QR tokens (one per user per shop)
CREATE TABLE IF NOT EXISTS staff_qr_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shop_id    UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  branch_id  UUID REFERENCES branches(id) ON DELETE SET NULL,
  token      UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_qr_tokens_token   ON staff_qr_tokens(token);
CREATE INDEX IF NOT EXISTS idx_staff_qr_tokens_shop    ON staff_qr_tokens(shop_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_qr_tokens_user_shop ON staff_qr_tokens(user_id, shop_id);

-- Staff check-in log (records each POS session)
CREATE TABLE IF NOT EXISTS staff_checkins (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shop_id        UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  branch_id      UUID REFERENCES branches(id) ON DELETE SET NULL,
  checked_in_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checked_out_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_staff_checkins_shop_date ON staff_checkins(shop_id, checked_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_checkins_user      ON staff_checkins(user_id, checked_in_at DESC);
