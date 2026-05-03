-- Migration 0016: Stock withdrawal requests

-- Extend stock_transaction_type enum if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stock_transaction_type') THEN
    ALTER TYPE stock_transaction_type ADD VALUE IF NOT EXISTS 'withdrawal';
  END IF;
END$$;

-- Withdrawal requests table
CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  branch_id     UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  staff_name    TEXT NOT NULL,
  note          TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  items         JSONB NOT NULL DEFAULT '[]',
  approved_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at   TIMESTAMPTZ,
  rejected_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_shop_status ON withdrawal_requests(shop_id, status);
CREATE INDEX IF NOT EXISTS idx_withdrawal_branch_date ON withdrawal_requests(branch_id, created_at DESC);
