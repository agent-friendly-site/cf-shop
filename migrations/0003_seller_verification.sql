-- 0003: seller verification of offline payment.
-- submit_payment_proof no longer marks an order paid; it sets
-- payment_submitted. The seller confirms receipt and amount with
-- confirm_payment, which records the verified amount and time here.
-- Existing orders are untouched: their status values stay as they are.
ALTER TABLE orders ADD COLUMN verified_amount_cny REAL;
ALTER TABLE orders ADD COLUMN verified_at TEXT;
ALTER TABLE orders ADD COLUMN verification_note TEXT;
