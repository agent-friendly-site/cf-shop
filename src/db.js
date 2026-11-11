// D1 data access for agent-friendly-platform.
// Every shop fact the Worker serves (products, policies, payment,
// recommendations, orders, proofs) comes from D1. Static prose files
// (llms.txt, guide.md, starter-prompt.txt, openapi.json, agent.json,
// mcp.json) live in src/data and are served as bundled files.

export const SHIPPING_FLAT = 12;
export const FREE_SHIPPING_OVER = 200;

async function rows(db, sql, ...params) {
  const { results } = await db.prepare(sql).bind(...params).all();
  return results;
}

export async function listShops(db) {
  return rows(db, "SELECT * FROM shops ORDER BY slug");
}

export async function getShop(db, slug) {
  return db.prepare("SELECT * FROM shops WHERE slug = ?").bind(slug).first();
}

export async function listProducts(db, shop) {
  // rowid = seed insertion order, i.e. the source files' product order.
  return rows(db, "SELECT * FROM products WHERE shop = ? ORDER BY rowid", shop);
}

export async function getProduct(db, shop, id) {
  return db
    .prepare("SELECT * FROM products WHERE shop = ? AND id = ?")
    .bind(shop, id)
    .first();
}

export async function getPolicies(db, shop) {
  return db.prepare("SELECT * FROM shop_policies WHERE shop = ?").bind(shop).first();
}

export const ORDER_STATUSES = [
  "pending_payment",
  "payment_submitted",
  "paid",
  "shipped",
  "completed",
  "cancelled",
];

// Allowed transitions: from-status -> [to-statuses]. Every status change
// must go through transitionOrder() so the order_events timeline is
// written together with the status update (one D1 batch, atomic).
const TRANSITIONS = {
  pending_payment: ["payment_submitted", "cancelled"],
  payment_submitted: ["paid", "cancelled"],
  paid: ["shipped"],
  shipped: ["completed"],
  completed: [],
  cancelled: [],
};

export const AUTO_COMPLETE_AFTER_DAYS = 7;

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function writeEvent(db, { orderId, event, fromStatus, toStatus, actor, note, now }) {
  const id = `evt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return db
    .prepare(
      "INSERT INTO order_events (id, order_id, event, from_status, to_status, actor, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(id, orderId, event, fromStatus ?? null, toStatus ?? null, actor, note || null, now);
}

export async function transitionOrder(db, order, toStatus, event, actor, note, extra = {}) {
  const from = order.status;
  if (!(TRANSITIONS[from] || []).includes(toStatus)) {
    const e = new Error(`order ${order.id} is ${from}; cannot move to ${toStatus}`);
    e.code = -32000;
    throw e;
  }
  const now = new Date().toISOString();
  const sets = ["status = ?", "updated_at = ?"];
  const params = [toStatus, now];
  for (const [col, val] of Object.entries(extra)) {
    sets.push(`${col} = ?`);
    params.push(val);
  }
  params.push(order.id);
  const update = db.prepare(`UPDATE orders SET ${sets.join(", ")} WHERE id = ?`).bind(...params);
  const evt = writeEvent(db, { orderId: order.id, event, fromStatus: from, toStatus, actor, note, now });
  await db.batch([update, evt]);
  return getOrder(db, order.id);
}

export async function listOrderEvents(db, orderId) {
  return rows(
    db,
    "SELECT event, from_status, to_status, actor, note, created_at FROM order_events WHERE order_id = ? ORDER BY created_at, rowid",
    orderId
  );
}

export async function getPayment(db, shop) {
  const row = await db.prepare("SELECT * FROM shop_payment WHERE shop = ?").bind(shop).first();
  if (!row) return null;
  const methods = await rows(
    db,
    "SELECT method_id AS id, label, instructions FROM payment_methods WHERE shop = ? ORDER BY rowid",
    shop
  );
  return { shop, payment: { online: false, method: "offline", summary: row.summary, methods, never_in_chat: JSON.parse(row.never_in_chat_json || "[]"), flow: JSON.parse(row.flow_json), order_statuses: ORDER_STATUSES } };
}

export async function getRecommendations(db, shop) {
  const recs = await rows(
    db,
    "SELECT product_id, best_for, why, alternative_if_out FROM recommendations WHERE shop = ? ORDER BY rank",
    shop
  );
  const bundles = await rows(
    db,
    "SELECT name, items_json, total_cny, note FROM shop_bundles WHERE shop = ? ORDER BY rowid",
    shop
  );
  return {
    recs,
    bundles: bundles.map((b) => ({ name: b.name, items: JSON.parse(b.items_json), total_cny: b.total_cny, note: b.note })),
  };
}

export function totals(items, products) {
  let subtotal = 0;
  const lines = [];
  for (const it of items) {
    const p = products.find((x) => x.id === it.product_id);
    if (!p) {
      const e = new Error(`unknown product_id: ${it.product_id}`);
      e.code = -32602;
      throw e;
    }
    const qty = it.quantity ?? 1;
    if (!Number.isInteger(qty) || qty < 1) {
      const e = new Error(`bad quantity for ${it.product_id}`);
      e.code = -32602;
      throw e;
    }
    if (p.stock < qty) {
      const e = new Error(`${p.name_zh || p.name} 库存不足（仅剩 ${p.stock} 件）`);
      e.code = -32000;
      throw e;
    }
    subtotal += p.price * qty;
    lines.push({ product_id: p.id, name: p.name_zh || p.name, unit_price: p.price, quantity: qty, line_total: p.price * qty });
  }
  const shipping = subtotal >= FREE_SHIPPING_OVER || subtotal === 0 ? 0 : SHIPPING_FLAT;
  const total = subtotal + shipping;
  const verbatim =
    shipping === 0
      ? `${subtotal} 元，满 200 元免邮，共 ${total} 元`
      : `${subtotal} 元 + ${shipping} 元运费 = ${total} 元`;
  return { lines, subtotal_cny: subtotal, shipping_cny: shipping, total_cny: total, verbatim };
}

function orderShape(row, proofs, timeline) {
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
    created_at: row.created_at,
    updated_at: row.updated_at,
    proofs: proofs || [],
    timeline: timeline || [],
  };
}

export async function getOrder(db, id) {
  const row = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
  if (!row) return null;
  const proofs = await rows(
    db,
    "SELECT * FROM payment_proofs WHERE order_id = ? ORDER BY created_at",
    id
  );
  const timeline = await listOrderEvents(db, id);
  return orderShape(row, proofs, timeline);
}

export async function listOrders(db, shop, { status, limit = 50, offset = 0 } = {}) {
  const params = [shop];
  let sql = "SELECT * FROM orders WHERE shop = ?";
  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }
  sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);
  const list = await rows(db, sql, ...params);
  const out = [];
  for (const row of list) {
    const proofs = await rows(db, "SELECT * FROM payment_proofs WHERE order_id = ? ORDER BY created_at", row.id);
    out.push(orderShape(row, proofs, []));
  }
  return out;
}

export async function orderCounts(db, shop) {
  const list = await rows(
    db,
    "SELECT status, COUNT(*) AS n FROM orders WHERE shop = ? GROUP BY status",
    shop
  );
  const counts = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0]));
  let total = 0;
  for (const r of list) {
    counts[r.status] = r.n;
    total += r.n;
  }
  return { ...counts, total };
}

export async function createOrder(db, { shop, items, total, idempotencyKey, buyerNote, buyerName, buyerContact, shippingAddress }) {
  const existing = await db
    .prepare("SELECT id FROM orders WHERE idempotency_key = ?")
    .bind(idempotencyKey)
    .first();
  if (existing) return { existing: true, order: await getOrder(db, existing.id) };
  const now = new Date().toISOString();
  const id = `ord_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await db
    .prepare(
      "INSERT INTO orders (id, shop, items_json, subtotal_cny, shipping_cny, total_cny, status, idempotency_key, buyer_note, buyer_name, buyer_contact, shipping_address, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(id, shop, JSON.stringify(total.lines), total.subtotal_cny, total.shipping_cny, total.total_cny, "pending_payment", idempotencyKey, buyerNote || null, buyerName || null, buyerContact || null, shippingAddress || null, now, now)
    .run();
  await writeEvent(db, { orderId: id, event: "order_created", fromStatus: null, toStatus: "pending_payment", actor: "buyer", note: null, now }).run();
  return { existing: false, order: await getOrder(db, id) };
}

export async function addPaymentProof(db, { orderId, paymentMethod, transactionId, amountCny }) {
  const order = await getOrder(db, orderId);
  if (!order) return null;
  // Submitting a proof never marks the order paid. It records the proof and
  // moves the order to payment_submitted (awaiting seller verification).
  // A proof on an already-paid (or later) order is rejected: the payment
  // is already verified and must not be re-opened by a new proof.
  if (order.status !== "pending_payment" && order.status !== "payment_submitted") {
    const e = new Error(`order ${orderId} is already ${order.status}; cannot submit a payment proof`);
    e.code = -32000;
    throw e;
  }
  const wasPending = order.status === "pending_payment";
  const now = new Date().toISOString();
  const id = `proof_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const insert = db
    .prepare(
      "INSERT INTO payment_proofs (id, order_id, payment_method, transaction_id, amount_cny, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(id, orderId, paymentMethod, transactionId, amountCny, now);
  if (wasPending) {
    const update = db
      .prepare("UPDATE orders SET status = 'payment_submitted', updated_at = ? WHERE id = ?")
      .bind(now, orderId);
    const evt = writeEvent(db, { orderId, event: "payment_proof_submitted", fromStatus: "pending_payment", toStatus: "payment_submitted", actor: "buyer", note: `${paymentMethod} ${transactionId}`, now });
    await db.batch([insert, update, evt]);
  } else {
    await insert.run();
  }
  return getOrder(db, orderId);
}

// Seller-side step: confirm receipt of the offline payment.
// Preconditions: the order exists, its status is payment_submitted, it has
// at least one proof, and verifiedAmountCny equals the order total.
// On mismatch the order stays payment_submitted and nothing is changed.
// On success the order becomes paid and the verified amount/time are recorded.
export async function confirmPayment(db, { orderId, verifiedAmountCny, note }) {
  const order = await getOrder(db, orderId);
  if (!order) {
    const e = new Error(`unknown order_id: ${orderId}`);
    e.code = -32602;
    throw e;
  }
  if (order.status !== "payment_submitted") {
    const e = new Error(
      `order ${orderId} is ${order.status}, not payment_submitted; only an order awaiting verification can be confirmed`
    );
    e.code = -32000;
    throw e;
  }
  if (!order.proofs || order.proofs.length === 0) {
    const e = new Error(`order ${orderId} has no payment proof; cannot confirm payment`);
    e.code = -32000;
    throw e;
  }
  if (verifiedAmountCny !== order.total_cny) {
    const e = new Error(
      `verified amount ${verifiedAmountCny} CNY does not match order total ${order.total_cny} CNY; order stays payment_submitted`
    );
    e.code = -32000;
    throw e;
  }
  const now = new Date().toISOString();
  return transitionOrder(db, order, "paid", "payment_confirmed", "seller", note || null, {
    verified_amount_cny: verifiedAmountCny,
    verified_at: now,
    verification_note: note || null,
  });
}

// Seller-side step: mark a paid order shipped. Only paid -> shipped.
export async function markShipped(db, { orderId, carrier, trackingNumber }) {
  const order = await getOrder(db, orderId);
  if (!order) {
    const e = new Error(`unknown order_id: ${orderId}`);
    e.code = -32602;
    throw e;
  }
  const now = new Date().toISOString();
  const note = [carrier, trackingNumber].filter(Boolean).join(" ") || null;
  return transitionOrder(db, order, "shipped", "shipped", "seller", note, {
    carrier: carrier || null,
    tracking_number: trackingNumber || null,
    shipped_at: now,
  });
}

// Buyer-side step: confirm receipt of a shipped order. Only shipped -> completed.
export async function confirmReceipt(db, { orderId }) {
  const order = await getOrder(db, orderId);
  if (!order) {
    const e = new Error(`unknown order_id: ${orderId}`);
    e.code = -32602;
    throw e;
  }
  const now = new Date().toISOString();
  return transitionOrder(db, order, "completed", "receipt_confirmed", "buyer", null, {
    completed_at: now,
  });
}

// Buyer- or seller-side step: cancel an order before it is paid.
// Only pending_payment / payment_submitted -> cancelled.
export async function cancelOrder(db, { orderId, reason, actor = "buyer" }) {
  const order = await getOrder(db, orderId);
  if (!order) {
    const e = new Error(`unknown order_id: ${orderId}`);
    e.code = -32602;
    throw e;
  }
  const now = new Date().toISOString();
  return transitionOrder(db, order, "cancelled", "cancelled", actor, reason || null, {
    cancelled_at: now,
    cancel_reason: reason || null,
  });
}

// Daily scheduled job: auto-complete orders shipped more than
// AUTO_COMPLETE_AFTER_DAYS ago with no buyer confirmation.
// Old orders without shipped_at are never auto-completed.
export async function autoCompleteShipped(db, days = AUTO_COMPLETE_AFTER_DAYS) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const stale = await rows(
    db,
    "SELECT * FROM orders WHERE status = 'shipped' AND shipped_at IS NOT NULL AND shipped_at < ? ORDER BY shipped_at",
    cutoff
  );
  const completed = [];
  for (const row of stale) {
    const order = await getOrder(db, row.id);
    const now = new Date().toISOString();
    const done = await transitionOrder(db, order, "completed", "auto_completed", "system", `发货满 ${days} 天未确认收货，自动完成`, { completed_at: now });
    completed.push(done.id);
  }
  return completed;
}

// --- seller admin: keys, sessions, product/policy management ---

export async function setAdminKey(db, shop, keyHash) {
  const now = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO shop_admin_keys (shop, key_hash, created_at) VALUES (?, ?, ?) ON CONFLICT(shop) DO UPDATE SET key_hash = excluded.key_hash, created_at = excluded.created_at, last_used_at = NULL"
    )
    .bind(shop, keyHash, now)
    .run();
}

export async function verifyAdminKey(db, shop, key) {
  const row = await db.prepare("SELECT key_hash FROM shop_admin_keys WHERE shop = ?").bind(shop).first();
  if (!row) return false;
  const hash = await sha256Hex(key);
  if (hash !== row.key_hash) return false;
  await db
    .prepare("UPDATE shop_admin_keys SET last_used_at = ? WHERE shop = ?")
    .bind(new Date().toISOString(), shop)
    .run();
  return true;
}

export async function createAdminSession(db, shop) {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db
    .prepare("INSERT INTO admin_sessions (token_hash, shop, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256Hex(token), shop, now, expires)
    .run();
  return { token, expires };
}

export async function getSessionShop(db, token) {
  if (!token) return null;
  const row = await db
    .prepare("SELECT shop, expires_at FROM admin_sessions WHERE token_hash = ?")
    .bind(await sha256Hex(token))
    .first();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row.shop;
}

export async function deleteAdminSession(db, token) {
  if (!token) return;
  await db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
}

export async function updateProduct(db, shop, id, { price, stock }) {
  const p = await getProduct(db, shop, id);
  if (!p) {
    const e = new Error(`unknown product_id: ${id}`);
    e.code = -32602;
    throw e;
  }
  const sets = [];
  const params = [];
  if (price !== undefined) {
    if (typeof price !== "number" || price < 0) {
      const e = new Error("price_cny must be a non-negative number");
      e.code = -32602;
      throw e;
    }
    sets.push("price = ?");
    params.push(price);
  }
  if (stock !== undefined) {
    if (!Number.isInteger(stock) || stock < 0) {
      const e = new Error("stock must be a non-negative integer");
      e.code = -32602;
      throw e;
    }
    sets.push("stock = ?");
    params.push(stock);
  }
  if (sets.length === 0) {
    const e = new Error("nothing to update: send price_cny and/or stock");
    e.code = -32602;
    throw e;
  }
  params.push(shop, id);
  await db.prepare(`UPDATE products SET ${sets.join(", ")} WHERE shop = ? AND id = ?`).bind(...params).run();
  return getProduct(db, shop, id);
}

export async function updatePolicies(db, shop, patch) {
  const pol = await getPolicies(db, shop);
  if (!pol) {
    const e = new Error(`unknown shop: ${shop}`);
    e.code = -32602;
    throw e;
  }
  const map = {
    shipping_flat_cny: "shipping_flat_cny",
    free_over_cny: "free_over_cny",
    lead_time: "lead_time",
    returns_window_days: "returns_window_days",
    returns_condition: "returns_condition",
    return_shipping: "return_shipping",
    privacy: "privacy",
  };
  const sets = [];
  const params = [];
  for (const [key, col] of Object.entries(map)) {
    if (patch[key] !== undefined) {
      sets.push(`${col} = ?`);
      params.push(patch[key]);
    }
  }
  if (sets.length > 0) {
    params.push(shop);
    await db.prepare(`UPDATE shop_policies SET ${sets.join(", ")} WHERE shop = ?`).bind(...params).run();
  }
  return getPolicies(db, shop);
}

export async function updatePaymentMethods(db, shop, methods) {
  // methods: [{id, instructions}] — only instructions are editable.
  for (const m of methods || []) {
    if (!m.id || typeof m.instructions !== "string") {
      const e = new Error("each payment method needs id and instructions");
      e.code = -32602;
      throw e;
    }
    await db
      .prepare("UPDATE payment_methods SET instructions = ? WHERE shop = ? AND method_id = ?")
      .bind(m.instructions, shop, m.id)
      .run();
  }
  return getPayment(db, shop);
}
