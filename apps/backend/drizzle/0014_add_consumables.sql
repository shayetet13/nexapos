-- Consumables (raw materials / supplies) per shop
CREATE TABLE IF NOT EXISTS consumables (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  unit       TEXT NOT NULL DEFAULT 'ชิ้น',
  quantity   NUMERIC(12,3) NOT NULL DEFAULT 0,
  min_qty    NUMERIC(12,3) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS consumables_shop_id_idx ON consumables(shop_id);

-- BOM: each product can use multiple consumables
CREATE TABLE IF NOT EXISTS product_consumables (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  consumable_id  UUID NOT NULL REFERENCES consumables(id) ON DELETE CASCADE,
  qty_per_unit   NUMERIC(12,3) NOT NULL DEFAULT 1,
  UNIQUE (product_id, consumable_id)
);

CREATE INDEX IF NOT EXISTS product_consumables_product_idx ON product_consumables(product_id);
CREATE INDEX IF NOT EXISTS product_consumables_consumable_idx ON product_consumables(consumable_id);
