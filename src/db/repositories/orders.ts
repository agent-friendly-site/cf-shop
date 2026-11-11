import {
  AUTO_COMPLETE_AFTER_DAYS,
  DomainRpcError,
  FREE_SHIPPING_OVER,
  ORDER_STATUSES,
  type Order,
  type OrderEvent,
  type OrderItemInput,
  type OrderLineItem,
  type OrderRow,
  type OrderStatus,
  type PaymentProof,
  type Product,
  rows,
  SHIPPING_FLAT,
  UNPAID_EXPIRY_MINUTES,
  writeEvent,
} from "../shared";

// Allowed transitions: from-status -> [to-statuses]. Every status change
// must go through transitionOrder() so the order_events timeline is
// written together with the status update (one D1 batch, atomic).
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ["payment_submitted", "cancelled"],
  payment_submitted: ["paid", "cancelled"],
  paid: ["shipped"],
  shipped: ["completed"],
  completed: [],
  cancelled: [],
};

export interface OrderTotals {
  lines: OrderLineItem[];
  subtotal_cny: number;
  shipping_cny: number;
  total_cny: number;
  verbatim: string;
}

export function totals(items: OrderItemInput[], products: Product[]): OrderTotals {
  let subtotal = 0;
  const lines: OrderLineItem[] = [];
  for (const it of items) {
    const p = products.find((x) => x.id === it.product_id);
    if (!p) {
      throw new DomainRpcError(`unknown product_id: ${it.product_id}`, -32602);
    }
    const qty = it.quantity ?? 1;
    if (!Number.isInteger(qty) || qty < 1) {
      throw new DomainRpcError(`bad quantity for ${it.product_id}`, -32602);
    }
    if (p.stock < qty) {
      throw new DomainRpcError(`${p.name_zh || p.name} 库存不足（仅剩 ${p.stock} 件）`, -32000);
    }
    subtotal += p.price * qty;
    lines.push({
      product_id: p.id,
      name: p.name_zh || p.name,
      unit_price: p.price,
      quantity: qty,
      line_total: p.price * qty,
    });
  }
  const shipping = subtotal >= FREE_SHIPPING_OVER || subtotal === 0 ? 0 : SHIPPING_FLAT;
  const total = subtotal + shipping;
  const verbatim =
    shipping === 0
      ? `${subtotal} 元，满 200 元免邮，共 ${total} 元`
      : `${subtotal} 元 + ${shipping} 元运费 = ${total} 元`;
  return { lines, subtotal_cny: subtotal, shipping_cny: shipping, total_cny: total, verbatim };
}

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
    // Payment deadline (v1.7.0): only pending_payment orders have one.
    payment_expires_at:
      row.status === "pending_payment"
        ? new Date(
            new Date(row.created_at).getTime() + UNPAID_EXPIRY_MINUTES * 60 * 1000,
          ).toISOString()
        : null,
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

export async function transitionOrder(
  db: D1Database,
  order: Order,
  toStatus: OrderStatus,
  event: string,
  actor: string,
  note: string | null,
  extra: Record<string, unknown> = {},
): Promise<Order | null> {
  const from = order.status;
  if (!(TRANSITIONS[from] || []).includes(toStatus)) {
    throw new DomainRpcError(`order ${order.id} is ${from}; cannot move to ${toStatus}`, -32000);
  }
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
  const existing = (await db
    .prepare("SELECT id FROM orders WHERE idempotency_key = ?")
    .bind(idempotencyKey)
    .first()) as {
    id: string;
  } | null;
  if (existing) return { existing: true, order: await getOrder(db, existing.id) };
  const now = new Date().toISOString();
  const id = `ord_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await db
    .prepare(
      "INSERT INTO orders (id, shop, items_json, subtotal_cny, shipping_cny, total_cny, status, idempotency_key, buyer_note, buyer_name, buyer_contact, shipping_address, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      id,
      shop,
      JSON.stringify(total.lines),
      total.subtotal_cny,
      total.shipping_cny,
      total.total_cny,
      "pending_payment",
      idempotencyKey,
      buyerNote || null,
      buyerName || null,
      buyerContact || null,
      shippingAddress || null,
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
  return { existing: false, order: await getOrder(db, id) };
}

export async function markShipped(
  db: D1Database,
  {
    orderId,
    carrier,
    trackingNumber,
  }: { orderId: string; carrier?: string; trackingNumber?: string },
) {
  const order = await getOrder(db, orderId);
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
  const order = await getOrder(db, orderId);
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
  const order = await getOrder(db, orderId);
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
  const order = await getOrder(db, orderId);
  if (!order) {
    throw new DomainRpcError(`unknown order_id: ${orderId}`, -32602);
  }
  if (["shipped", "completed", "cancelled"].includes(order.status)) {
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

export async function expireUnpaidOrders(
  db: D1Database,
  minutes = UNPAID_EXPIRY_MINUTES,
): Promise<string[]> {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const stale = await rows<OrderRow>(
    db,
    "SELECT * FROM orders WHERE status = 'pending_payment' AND created_at < ? ORDER BY created_at",
    cutoff,
  );
  const cancelled: string[] = [];
  for (const row of stale) {
    const order = await getOrder(db, row.id);
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
  const stale = await rows<{ id: string }>(
    db,
    "SELECT * FROM orders WHERE status = 'shipped' AND shipped_at IS NOT NULL AND shipped_at < ? ORDER BY shipped_at",
    cutoff,
  );
  const completed: string[] = [];
  for (const row of stale) {
    const order = await getOrder(db, row.id);
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
