-- Membership enhancements: birthday + shop config
ALTER TABLE customers ADD COLUMN IF NOT EXISTS birthday DATE;

ALTER TABLE shops ADD COLUMN IF NOT EXISTS membership_config JSONB DEFAULT '{"points_per_10_baht":1,"redemption_rate":100,"tier_silver":1000,"tier_gold":5000,"enabled":true}'::jsonb;

-- For birthday notifications dedupe
ALTER TABLE shop_notifications ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
