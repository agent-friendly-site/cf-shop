/**
 * Order data access (Phase 3.x harden).
 * Reads + low-level writes only. Domain rules and orchestration live in services/orders.ts.
 */
import { paymentExpiresAt } from "../../domain/order";
import {
  ORDER_STATUSES,
  type Order,
  type OrderEvent,
  type OrderRow,
  type OrderStatus,
  type PaymentProof,
  rows,
  writeEvent,
} from "../shared";

function orderShape(row: OrderRow, proofs: PaymentProof[], timeline: OrderEvent[]): Order {
  return {
    id: row.id,
    shop: row.shop,
    items: JSON.parse(row.items_json),
    subtotal_cny: row.subtotal_cny,
    shipping_cny: row.shipping_cny,
    total_cny: row.total_cny,
    status: row.status,
    idempotency_key: row.idempotency_key,
    buyer_note: row.buyer_note,
    buyer_name: row.buyer_name ?? null,
    buyer_contact: row.buyer_contact ?? null,
    shipping_address: row.shipping_address ?? null,
    carrier: row.carrier ?? null,
    tracking_number: row.tracking_number ?? null,
    shipped_at: row.shipped_at ?? null,
    completed_at: row.completed_at ?? null,
    cancelled_at: row.cancelled_at ?? null,
    cancel_reason: row.cancel_reason ?? null,
    verified_amount_cny: row.verified_amount_cny ?? null,
    verified_at: row.verified_at ?? null,
    verification_note: row.verification_note ?? null,
    payment_expires_at: paymentExpiresAt(row.created_at, row.status),
    created_at: row.created_at,
    updated_at: row.updated_at,
    proofs: proofs || [],
    timeline: timeline || [],
  };
}

export async function listOrderEvents(db: D1Database, orderId: string): Promise<OrderEvent[]> {
  return rows<OrderEvent>(
    db,
    "SELECT event, from_status, to_status, actor, note, created_at FROM order_events WHERE order_id = ? ORDER BY created_at, rowid",
    orderId,
  );
}

export async function getOrder(db: D1Database, id: string): Promise<Order | null> {
  const row = (await db
    .prepare("SELECT * FROM orders WHERE id = ?")
    .bind(id)
    .first()) as OrderRow | null;
  if (!row) return null;
  const proofs = await rows<PaymentProof>(
    db,
    "SELECT * FROM payment_proofs WHERE order_id = ? ORDER BY created_at",
    id,
  );
  const timeline = await listOrderEvents(db, id);
  return orderShape(row, proofs, timeline);
}

export async function listOrders(
  db: D1Database,
  shop: string,
  { status, limit = 50, offset = 0 }: { status?: string; limit?: number; offset?: number } = {},
): Promise<Order[]> {
  const params: unknown[] = [shop];
  let sql = "SELECT * FROM orders WHERE shop = ?";
  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }
  sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);
  const list = await rows<OrderRow>(db, sql, ...params);
  const out = [];
  for (const row of list) {
    const proofs = await rows<PaymentProof>(
      db,
      "SELECT * FROM payment_proofs WHERE order_id = ? ORDER BY created_at",
      row.id,
    );
    out.push(orderShape(row, proofs, []));
  }
  return out;
}

export async function orderCounts(db: D1Database, shop: string) {
  const list = await rows<{ status: OrderStatus; n: number }>(
    db,
    "SELECT status, COUNT(*) AS n FROM orders WHERE shop = ? GROUP BY status",
    shop,
  );
  const counts: Record<OrderStatus, number> = Object.fromEntries(
    ORDER_STATUSES.map((s) => [s, 0]),
  ) as Record<OrderStatus, number>;
  let total = 0;
  for (const r of list) {
    counts[r.status] = r.n;
    total += r.n;
  }
  return { ...counts, total };
}

export async function findOrderIdByIdempotencyKey(
  db: D1Database,
  idempotencyKey: string,
): Promise<string | null> {
  const existing = (await db
    .prepare("SELECT id FROM orders WHERE idempotency_key = ?")
    .bind(idempotencyKey)
    .first()) as { id: string } | null;
  return existing?.id ?? null;
}

export async function insertOrderRow(
  db: D1Database,
  {
    id,
    shop,
    itemsJson,
    subtotalCny,
    shippingCny,
    totalCny,
    idempotencyKey,
    buyerNote,
    buyerName,
    buyerContact,
    shippingAddress,
    now,
  }: {
    id: string;
    shop: string;
    itemsJson: string;
    subtotalCny: number;
    shippingCny: number;
    totalCny: number;
    idempotencyKey: string;
    buyerNote: string | null;
    buyerName: string | null;
    buyerContact: string | null;
    shippingAddress: string;
    now: string;
  },
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO orders (id, shop, items_json, subtotal_cny, shipping_cny, total_cny, status, idempotency_key, buyer_note, buyer_name, buyer_contact, shipping_address, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      id,
      shop,
      itemsJson,
      subtotalCny,
      shippingCny,
      totalCny,
      "pending_payment",
      idempotencyKey,
      buyerNote,
      buyerName,
      buyerContact,
      shippingAddress,
      now,
      now,
    )
    .run();
  await writeEvent(db, {
    orderId: id,
    event: "order_created",
    fromStatus: null,
    toStatus: "pending_payment",
    actor: "buyer",
    note: null,
    now,
  }).run();
}

/** Persist a status change + timeline event. Caller must validate the transition. */
export async function persistTransition(
  db: D1Database,
  order: Order,
  toStatus: OrderStatus,
  event: string,
  actor: string,
  note: string | null,
  extra: Record<string, unknown> = {},
): Promise<Order | null> {
  const from = order.status;
  const now = new Date().toISOString();
  const sets = ["status = ?", "updated_at = ?"];
  const params: unknown[] = [toStatus, now];
  for (const [col, val] of Object.entries(extra)) {
    sets.push(`${col} = ?`);
    params.push(val);
  }
  params.push(order.id);
  const update = db.prepare(`UPDATE orders SET ${sets.join(", ")} WHERE id = ?`).bind(...params);
  const evt = writeEvent(db, {
    orderId: order.id,
    event,
    fromStatus: from,
    toStatus,
    actor,
    note,
    now,
  });
  await db.batch([update, evt]);
  return getOrder(db, order.id);
}

export async function persistBuyerInfoUpdate(
  db: D1Database,
  {
    order,
    fields,
    now,
  }: {
    order: Order;
    fields: { col: string; val: string; label: string }[];
    now: string;
  },
): Promise<Order | null> {
  const sets = ["updated_at = ?"];
  const params: unknown[] = [now];
  for (const f of fields) {
    sets.push(`${f.col} = ?`);
    params.push(f.val);
  }
  params.push(order.id);
  const update = db.prepare(`UPDATE orders SET ${sets.join(", ")} WHERE id = ?`).bind(...params);
  const evt = writeEvent(db, {
    orderId: order.id,
    event: "buyer_info_updated",
    fromStatus: order.status,
    toStatus: order.status,
    actor: "buyer",
    note: `补填/修改收货信息：${fields.map((f) => f.label).join("、")}`,
    now,
  });
  await db.batch([update, evt]);
  return getOrder(db, order.id);
}

export async function listStaleUnpaidOrderIds(
  db: D1Database,
  cutoffIso: string,
): Promise<string[]> {
  const stale = await rows<{ id: string }>(
    db,
    "SELECT id FROM orders WHERE status = 'pending_payment' AND created_at < ? ORDER BY created_at",
    cutoffIso,
  );
  return stale.map((r) => r.id);
}

export async function listStaleShippedOrderIds(
  db: D1Database,
  cutoffIso: string,
): Promise<string[]> {
  const stale = await rows<{ id: string }>(
    db,
    "SELECT id FROM orders WHERE status = 'shipped' AND shipped_at IS NOT NULL AND shipped_at < ? ORDER BY shipped_at",
    cutoffIso,
  );
  return stale.map((r) => r.id);
}
