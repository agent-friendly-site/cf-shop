/**
 * Order service (Phase 3.x harden).
 * Owns status transitions, create/cancel/buyer-info rules, and job sweeps.
 * Callers (routes / MCP / admin) should use this module — not repositories.
 */
import * as ordersRepo from "../db/repositories/orders";
import {
  AUTO_COMPLETE_AFTER_DAYS,
  DomainRpcError,
  type Order,
  type OrderItemInput,
  type OrderStatus,
  type Product,
  UNPAID_EXPIRY_MINUTES,
} from "../db/shared";
import { totals as computeTotals, type OrderTotals } from "../domain/money";
import { assertCanTransition, canUpdateBuyerInfo } from "../domain/order";

export { getOrder, listOrderEvents, listOrders, orderCounts } from "../db/repositories/orders";
export type { OrderTotals };

/** Re-export domain totals so existing `db.totals` callers stay unchanged. */
export function totals(items: OrderItemInput[], products: Product[]): OrderTotals {
  return computeTotals(items, products);
}

export async function transitionOrder(
  db: D1Database,
  order: Order,
  toStatus: OrderStatus,
  event: string,
  actor: string,
  note: string | null,
  extra: Record<string, unknown> = {},
): Promise<Order | null> {
  assertCanTransition(order.id, order.status, toStatus);
  return ordersRepo.persistTransition(db, order, toStatus, event, actor, note, extra);
}

export async function createOrder(
  db: D1Database,
  {
    shop,
    total,
    idempotencyKey,
    buyerNote,
    buyerName,
    buyerContact,
    shippingAddress,
  }: {
    shop: string;
    items: OrderItemInput[];
    total: OrderTotals;
    idempotencyKey: string;
    buyerNote?: string;
    buyerName?: string;
    buyerContact?: string;
    shippingAddress?: string;
  },
) {
  // The shipping address is required at the tool level (v1.5.0): the
  // seller cannot ship without one, so an order without an address
  // cannot be created at all. The MCP schema enforces this first;
  // this check is the second gate for any direct caller.
  if (typeof shippingAddress !== "string" || !shippingAddress.trim()) {
    throw new DomainRpcError(
      "shipping_address is required: the seller cannot ship without an address",
      -32602,
    );
  }
  shippingAddress = shippingAddress.trim();
  const existingId = await ordersRepo.findOrderIdByIdempotencyKey(db, idempotencyKey);
  if (existingId) {
    return { existing: true, order: await ordersRepo.getOrder(db, existingId) };
  }
  const now = new Date().toISOString();
  const id = `ord_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await ordersRepo.insertOrderRow(db, {
    id,
    shop,
    itemsJson: JSON.stringify(total.lines),
    subtotalCny: total.subtotal_cny,
    shippingCny: total.shipping_cny,
    totalCny: total.total_cny,
    idempotencyKey,
    buyerNote: buyerNote || null,
    buyerName: buyerName || null,
    buyerContact: buyerContact || null,
    shippingAddress,
    now,
  });
  return { existing: false, order: await ordersRepo.getOrder(db, id) };
}

export async function markShipped(
  db: D1Database,
  {
    orderId,
    carrier,
    trackingNumber,
  }: { orderId: string; carrier?: string; trackingNumber?: string },
) {
  const order = await ordersRepo.getOrder(db, orderId);
  if (!order) {
    throw new DomainRpcError(`unknown order_id: ${orderId}`, -32602);
  }
  const now = new Date().toISOString();
  const note = [carrier, trackingNumber].filter(Boolean).join(" ") || null;
  return transitionOrder(db, order, "shipped", "shipped", "seller", note, {
    carrier: carrier || null,
    tracking_number: trackingNumber || null,
    shipped_at: now,
  });
}

export async function confirmReceipt(db: D1Database, { orderId }: { orderId: string }) {
  const order = await ordersRepo.getOrder(db, orderId);
  if (!order) {
    throw new DomainRpcError(`unknown order_id: ${orderId}`, -32602);
  }
  const now = new Date().toISOString();
  return transitionOrder(db, order, "completed", "receipt_confirmed", "buyer", null, {
    completed_at: now,
  });
}

export async function cancelOrder(
  db: D1Database,
  { orderId, reason, actor = "buyer" }: { orderId: string; reason?: string; actor?: string },
) {
  const order = await ordersRepo.getOrder(db, orderId);
  if (!order) {
    throw new DomainRpcError(`unknown order_id: ${orderId}`, -32602);
  }
  const now = new Date().toISOString();
  return transitionOrder(db, order, "cancelled", "cancelled", actor, reason || null, {
    cancelled_at: now,
    cancel_reason: reason || null,
  });
}

export async function updateBuyerInfo(
  db: D1Database,
  {
    orderId,
    buyerName,
    buyerContact,
    shippingAddress,
  }: { orderId: string; buyerName?: string; buyerContact?: string; shippingAddress?: string },
) {
  const order = await ordersRepo.getOrder(db, orderId);
  if (!order) {
    throw new DomainRpcError(`unknown order_id: ${orderId}`, -32602);
  }
  if (!canUpdateBuyerInfo(order.status)) {
    throw new DomainRpcError(
      `order ${orderId} is ${order.status}; buyer info can no longer be changed`,
      -32000,
    );
  }
  const fields: { col: string; val: string; label: string }[] = [];
  const check = (value: string | undefined, col: string, label: string) => {
    if (value === undefined) return;
    if (typeof value !== "string" || !value.trim()) {
      throw new DomainRpcError(`${col} must be a non-empty string`, -32602);
    }
    fields.push({ col, val: value.trim(), label });
  };
  check(buyerName, "buyer_name", "姓名");
  check(buyerContact, "buyer_contact", "联系方式");
  check(shippingAddress, "shipping_address", "收货地址");
  if (fields.length === 0) {
    throw new DomainRpcError(
      "at least one of buyer_name, buyer_contact, shipping_address is required",
      -32602,
    );
  }
  const now = new Date().toISOString();
  return ordersRepo.persistBuyerInfoUpdate(db, { order, fields, now });
}

export async function expireUnpaidOrders(
  db: D1Database,
  minutes = UNPAID_EXPIRY_MINUTES,
): Promise<string[]> {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const staleIds = await ordersRepo.listStaleUnpaidOrderIds(db, cutoff);
  const cancelled: string[] = [];
  for (const id of staleIds) {
    const order = await ordersRepo.getOrder(db, id);
    if (!order) continue;
    const now = new Date().toISOString();
    const reason = `下单 ${minutes} 分钟未付款，自动取消`;
    const done = await transitionOrder(db, order, "cancelled", "auto_cancelled", "system", reason, {
      cancelled_at: now,
      cancel_reason: reason,
    });
    if (done) cancelled.push(done.id);
  }
  return cancelled;
}

export async function autoCompleteShipped(
  db: D1Database,
  days = AUTO_COMPLETE_AFTER_DAYS,
): Promise<string[]> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const staleIds = await ordersRepo.listStaleShippedOrderIds(db, cutoff);
  const completed: string[] = [];
  for (const id of staleIds) {
    const order = await ordersRepo.getOrder(db, id);
    if (!order) continue;
    const now = new Date().toISOString();
    const done = await transitionOrder(
      db,
      order,
      "completed",
      "auto_completed",
      "system",
      `发货满 ${days} 天未确认收货，自动完成`,
      {
        completed_at: now,
      },
    );
    if (done) completed.push(done.id);
  }
  return completed;
}
