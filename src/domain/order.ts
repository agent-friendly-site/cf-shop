/**
 * Order domain: status machine and pure predicates.
 * Every status change must still go through transitionOrder() so the
 * order_events timeline is written with the status update.
 */
import { type OrderStatus, UNPAID_EXPIRY_MINUTES } from "./constants";
import { DomainRpcError } from "./errors";

/** Allowed transitions: from-status → [to-statuses]. */
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ["payment_submitted", "cancelled"],
  payment_submitted: ["paid", "cancelled"],
  paid: ["shipped"],
  shipped: ["completed"],
  completed: [],
  cancelled: [],
};

export function allowedTransitions(from: OrderStatus): readonly OrderStatus[] {
  return TRANSITIONS[from] ?? [];
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return allowedTransitions(from).includes(to);
}

/** Throw DomainRpcError when `from → to` is illegal (same message as before). */
export function assertCanTransition(orderId: string, from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new DomainRpcError(`order ${orderId} is ${from}; cannot move to ${to}`, -32000);
  }
}

/** Buyer/seller may cancel only before paid. */
export function canCancel(status: OrderStatus): boolean {
  return status === "pending_payment" || status === "payment_submitted";
}

/** Buyer info is frozen once shipped / completed / cancelled. */
export function canUpdateBuyerInfo(status: OrderStatus): boolean {
  return !["shipped", "completed", "cancelled"].includes(status);
}

/** Pending payment expires `minutes` after created_at (v1.7.0). */
export function isUnpaidExpired(
  createdAt: string,
  nowMs: number = Date.now(),
  minutes: number = UNPAID_EXPIRY_MINUTES,
): boolean {
  return new Date(createdAt).getTime() + minutes * 60 * 1000 <= nowMs;
}

export function paymentExpiresAt(
  createdAt: string,
  status: OrderStatus,
  minutes: number = UNPAID_EXPIRY_MINUTES,
): string | null {
  if (status !== "pending_payment") return null;
  return new Date(new Date(createdAt).getTime() + minutes * 60 * 1000).toISOString();
}
