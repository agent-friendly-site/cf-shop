-- agent-friendly-platform D1 schema (0001_init)
-- Shops, catalog, policies, payment, recommendations, orders, proofs.
-- Catalog data is seeded from src/data (which was imported verbatim from
-- the GitHub Pages shop files); orders are written only by the Worker.

CREATE TABLE IF NOT EXISTS shops (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_zh TEXT,
  category TEXT,
  description TEXT,
  city TEXT,
  latitude REAL,
  longitude REAL,
  address TEXT,
  pickup TEXT,
  currency TEXT NOT NULL DEFAULT 'CNY'
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  shop TEXT NOT NULL REFERENCES shops(slug),
  name TEXT NOT NULL,
  name_zh TEXT,
  price REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  stock INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  url TEXT,
  image_url TEXT,
  image_credit TEXT
);

CREATE TABLE IF NOT EXISTS shop_policies (
  shop TEXT PRIMARY KEY REFERENCES shops(slug),
  shipping_flat_cny REAL NOT NULL,
  free_over_cny REAL NOT NULL,
  lead_time TEXT NOT NULL,
  returns_window_days INTEGER NOT NULL,
  returns_condition TEXT,
  return_shipping TEXT,
  privacy TEXT,
  order_statuses TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_methods (
  shop TEXT NOT NULL REFERENCES shops(slug),
  method_id TEXT NOT NULL,
  label TEXT NOT NULL,
  instructions TEXT NOT NULL,
  PRIMARY KEY (shop, method_id)
);

CREATE TABLE IF NOT EXISTS shop_payment (
  shop TEXT PRIMARY KEY REFERENCES shops(slug),
  summary TEXT NOT NULL,
  flow_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recommendations (
  shop TEXT NOT NULL REFERENCES shops(slug),
  product_id TEXT NOT NULL,
  best_for TEXT,
  why TEXT,
  alternative_if_out TEXT,
  rank INTEGER NOT NULL,
  PRIMARY KEY (shop, product_id)
);

CREATE TABLE IF NOT EXISTS shop_bundles (
  shop TEXT NOT NULL REFERENCES shops(slug),
  name TEXT NOT NULL,
  items_json TEXT NOT NULL,
  total_cny REAL NOT NULL,
  note TEXT,
  PRIMARY KEY (shop, name)
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  shop TEXT NOT NULL,
  items_json TEXT NOT NULL,
  subtotal_cny REAL NOT NULL,
  shipping_cny REAL NOT NULL,
  total_cny REAL NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  buyer_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_proofs (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  payment_method TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  amount_cny REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_shop ON products(shop);
CREATE INDEX IF NOT EXISTS idx_orders_shop ON orders(shop);
CREATE INDEX IF NOT EXISTS idx_proofs_order ON payment_proofs(order_id);
