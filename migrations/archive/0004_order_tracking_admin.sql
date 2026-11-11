-- 0004: order tracking + seller admin.
-- Orders gain buyer info (needed to ship) and the full lifecycle:
-- pending_payment -> payment_submitted -> paid -> shipped -> completed,
-- with cancelled before paid. Every status change writes one row in
-- order_events (append-only timeline). shop_admin_keys stores only
-- SHA-256 hashes of per-shop admin keys; admin_sessions stores hashes
-- of login session tokens (24h). Existing orders are untouched.
ALTER TABLE orders ADD COLUMN buyer_name TEXT;
ALTER TABLE orders ADD COLUMN buyer_contact TEXT;
ALTER TABLE orders ADD COLUMN shipping_address TEXT;
ALTER TABLE orders ADD COLUMN carrier TEXT;
ALTER TABLE orders ADD COLUMN tracking_number TEXT;
ALTER TABLE orders ADD COLUMN shipped_at TEXT;
ALTER TABLE orders ADD COLUMN completed_at TEXT;
ALTER TABLE orders ADD COLUMN cancelled_at TEXT;
ALTER TABLE orders ADD COLUMN cancel_reason TEXT;

CREATE TABLE IF NOT EXISTS order_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  event TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shop_admin_keys (
  shop TEXT PRIMARY KEY REFERENCES shops(slug),
  key_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  shop TEXT NOT NULL REFERENCES shops(slug),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_order ON order_events(order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(shop, status, created_at);
