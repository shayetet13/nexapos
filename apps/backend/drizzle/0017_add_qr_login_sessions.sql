-- Migration: QR Login Sessions (WeChat-style QR login)
-- Ephemeral sessions: POS shows QR → phone scans & confirms → POS logs in

CREATE TABLE IF NOT EXISTS qr_login_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token        UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'confirmed', 'used', 'expired')),
  user_id      UUID,
  shop_id      UUID,
  branch_id    UUID,
  login_token  UUID UNIQUE,          -- one-time token POS uses to exchange for session
  confirmed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '10 seconds')
);

CREATE INDEX IF NOT EXISTS idx_qr_login_sessions_token
  ON qr_login_sessions(token);

CREATE INDEX IF NOT EXISTS idx_qr_login_sessions_expires
  ON qr_login_sessions(expires_at)
  WHERE status = 'pending';
