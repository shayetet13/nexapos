-- Add daily_seq: running number per shop, resets to 1 at midnight Bangkok time
ALTER TABLE orders ADD COLUMN IF NOT EXISTS daily_seq integer NOT NULL DEFAULT 1;
