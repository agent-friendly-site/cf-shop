-- v1.6.0: image payment proofs via a one-time upload link (R2 storage).
-- payment_proofs gains proof_type ('transaction' | 'image') and image
-- columns; transaction_id / amount_cny become nullable because an image
-- proof has neither until the seller reads them off the screenshot.
-- proof_upload_tokens holds one-time upload links (token hash only).
DROP INDEX IF EXISTS idx_proofs_order;
ALTER TABLE payment_proofs RENAME TO payment_proofs_old;
CREATE TABLE payment_proofs (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  payment_method TEXT NOT NULL,
  transaction_id TEXT,
  amount_cny REAL,
  proof_type TEXT NOT NULL DEFAULT 'transaction',
  r2_key TEXT,
  file_name TEXT,
  mime_type TEXT,
  file_size INTEGER,
  created_at TEXT NOT NULL
);
INSERT INTO payment_proofs (id, order_id, payment_method, transaction_id, amount_cny, created_at)
  SELECT id, order_id, payment_method, transaction_id, amount_cny, created_at FROM payment_proofs_old;
DROP TABLE payment_proofs_old;
CREATE INDEX idx_proofs_order ON payment_proofs(order_id);
CREATE TABLE IF NOT EXISTS proof_upload_tokens (
  token_hash TEXT PRIMARY KEY,
  shop TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_upload_tokens_order ON proof_upload_tokens(order_id);
