-- Promotions and combos for POS
CREATE TABLE IF NOT EXISTS promotions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('percent','fixed')),
  value      NUMERIC(10,2) NOT NULL,
  color      TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS promotions_shop_id_idx ON promotions(shop_id);

CREATE TABLE IF NOT EXISTS combos (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  price      NUMERIC(12,2) NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS combos_shop_id_idx ON combos(shop_id);

CREATE TABLE IF NOT EXISTS combo_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_id   UUID NOT NULL REFERENCES combos(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity   INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS combo_items_combo_id_idx ON combo_items(combo_id);

