-- 0002: shop_payment.never_in_chat_json
-- The source payment.json lists values that must never be sent in chat
-- (card numbers, verification codes, payment passwords). They were
-- dropped by the 0001 seed because there was no column for them.
ALTER TABLE shop_payment ADD COLUMN never_in_chat_json TEXT NOT NULL DEFAULT '[]';
