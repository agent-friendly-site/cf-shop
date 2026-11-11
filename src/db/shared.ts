// Shared types, constants, and D1 helpers for db/repositories.
// Phase 2.2: extracted from the former god module without behavior changes.
// Phase 3.1: constants + DomainRpcError live in domain/; re-exported here
// so existing `from "../shared"` imports keep working.

export {
  AUTO_COMPLETE_AFTER_DAYS,
  FREE_SHIPPING_OVER,
  ORDER_STATUSES,
  type OrderStatus,
  PROOF_UPLOAD_TTL_DAYS,
  SHIPPING_FLAT,
  UNPAID_EXPIRY_MINUTES,
} from "../domain/constants";
export { DomainError, DomainRpcError, toHttpError, toMcpError } from "../domain/errors";

import type { OrderStatus } from "../domain/constants";

export interface Shop {
  slug: string;
  name: string;
  name_zh: string;
  category: string;
  description: string;
}

export interface Product {
  id: string;
  shop: string;
  name: string;
  name_zh: string;
  price: number;
  currency: string;
  stock: number;
  description: string;
  url?: string;
  image_url?: string | null;
  image_credit?: string | null;
}

export interface ShopPolicies {
  shop: string;
  shipping_flat_cny: number;
  free_over_cny: number;
  lead_time: string;
  returns_window_days: number;
  returns_condition: string;
  return_shipping: string;
  privacy: string;
  order_statuses: string;
}

export interface OrderLineItem {
  product_id: string;
  name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
}

export interface OrderItemInput {
  product_id: string;
  quantity?: number;
}

export interface PaymentProof {
  id: string;
  order_id: string;
  payment_method: string;
  transaction_id?: string | null;
  amount_cny?: number | null;
  proof_type?: string;
  r2_key?: string | null;
  file_name?: string | null;
  mime_type?: string | null;
  file_size?: number | null;
  created_at: string;
}

export interface OrderEvent {
  event: string;
  from_status: string | null;
  to_status: string | null;
  actor: string;
  note: string | null;
  created_at: string;
}

export interface Order {
  id: string;
  shop: string;
  items: OrderLineItem[];
  subtotal_cny: number;
  shipping_cny: number;
  total_cny: number;
  status: OrderStatus;
  idempotency_key: string;
  buyer_note: string | null;
  buyer_name: string | null;
  buyer_contact: string | null;
  shipping_address: string | null;
  carrier: string | null;
  tracking_number: string | null;
  shipped_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  verified_amount_cny: number | null;
  verified_at: string | null;
  verification_note: string | null;
  payment_expires_at: string | null;
  created_at: string;
  updated_at: string;
  proofs: PaymentProof[];
  timeline: OrderEvent[];
}

export interface OrderRow {
  id: string;
  shop: string;
  items_json: string;
  subtotal_cny: number;
  shipping_cny: number;
  total_cny: number;
  status: OrderStatus;
  idempotency_key: string;
  buyer_note: string | null;
  buyer_name: string | null;
  buyer_contact: string | null;
  shipping_address: string | null;
  carrier: string | null;
  tracking_number: string | null;
  shipped_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  verified_amount_cny: number | null;
  verified_at: string | null;
  verification_note: string | null;
  created_at: string;
  updated_at: string;
}

export async function rows<T extends object = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  const { results } = await db
    .prepare(sql)
    .bind(...params)
    .all();
  return (results ?? []) as T[];
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function writeEvent(
  db: D1Database,
  {
    orderId,
    event,
    fromStatus,
    toStatus,
    actor,
    note,
    now,
  }: {
    orderId: string;
    event: string;
    fromStatus: string | null;
    toStatus: string | null;
    actor: string;
    note: string | null;
    now: string;
  },
) {
  const id = `evt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return db
    .prepare(
      "INSERT INTO order_events (id, order_id, event, from_status, to_status, actor, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id, orderId, event, fromStatus ?? null, toStatus ?? null, actor, note || null, now);
}
