/** Shared domain constants — times, money, status labels. */

export const ORDER_STATUSES = [
  "pending_payment",
  "payment_submitted",
  "paid",
  "shipped",
  "completed",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const SHIPPING_FLAT = 12;
export const FREE_SHIPPING_OVER = 200;
export const AUTO_COMPLETE_AFTER_DAYS = 7;
export const UNPAID_EXPIRY_MINUTES = 15;
export const PROOF_UPLOAD_TTL_DAYS = 7;
