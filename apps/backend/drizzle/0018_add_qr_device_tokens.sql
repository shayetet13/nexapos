-- Long-lived device tokens for QR login (phone remembers staff session)
-- Phone stores device_token after first confirm; uses it instead of Supabase JWT on 2nd+ scan.
CREATE TABLE IF NOT EXISTS qr_device_tokens (
  token      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS qr_device_tokens_user_idx ON qr_device_tokens (user_id);
