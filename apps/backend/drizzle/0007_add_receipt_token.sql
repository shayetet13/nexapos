-- Add receipt_token: public UUID for customer QR receipt link
ALTER TABLE orders ADD COLUMN IF NOT EXISTS receipt_token uuid NOT NULL DEFAULT gen_random_uuid();
