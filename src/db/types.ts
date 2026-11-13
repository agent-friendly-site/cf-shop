import type { OrderStatus } from "../domain/constants";

export type { OrderStatus };

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
