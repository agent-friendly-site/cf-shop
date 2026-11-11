/**
 * Payment / proof domain predicates (Phase 3.2).
 * Keep error messages identical to the pre-refactor Worker.
 */
import type { OrderStatus } from "./constants";
import { DomainRpcError } from "./errors";

const PROOF_UPLOADABLE = new Set<OrderStatus>(["pending_payment", "payment_submitted"]);

export function canSubmitProof(status: OrderStatus): boolean {
  return PROOF_UPLOADABLE.has(status);
}

export function assertCanSubmitProof(orderId: string, status: OrderStatus): void {
  if (!canSubmitProof(status)) {
    throw new DomainRpcError(
      `order ${orderId} is already ${status}; cannot submit a payment proof`,
      -32000,
    );
  }
}

export type ConfirmableOrder = {
  id: string;
  status: OrderStatus;
  total_cny: number;
  proofs: unknown[] | null | undefined;
};

/** Seller confirm_payment preconditions (existence checked by caller). */
export function assertCanConfirmPayment(order: ConfirmableOrder, verifiedAmountCny: number): void {
  if (order.status !== "payment_submitted") {
    throw new DomainRpcError(
      `order ${order.id} is ${order.status}, not payment_submitted; only an order awaiting verification can be confirmed`,
      -32000,
    );
  }
  if (!order.proofs || order.proofs.length === 0) {
    throw new DomainRpcError(
      `order ${order.id} has no payment proof; cannot confirm payment`,
      -32000,
    );
  }
  if (verifiedAmountCny !== order.total_cny) {
    throw new DomainRpcError(
      `verified amount ${verifiedAmountCny} CNY does not match order total ${order.total_cny} CNY; order stays payment_submitted`,
      -32000,
    );
  }
}

export type UploadTokenRow = {
  shop: string;
  order_id: string;
  used_at: string | null;
  expires_at: string;
  token_hash: string;
};

/**
 * Return the row when the one-time upload token is still usable;
 * otherwise null (same outcomes as verifyProofUploadToken).
 */
export function matchProofUploadToken(
  row: UploadTokenRow | null | undefined,
  { shop, orderId, nowMs = Date.now() }: { shop: string; orderId: string; nowMs?: number },
): UploadTokenRow | null {
  if (!row) return null;
  if (row.shop !== shop || row.order_id !== orderId) return null;
  if (row.used_at) return null;
  if (new Date(row.expires_at).getTime() < nowMs) return null;
  return row;
}
