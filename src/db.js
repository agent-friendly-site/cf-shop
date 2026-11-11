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

export async function getPayment(db, shop) {
  const row = await db.prepare("SELECT * FROM shop_payment WHERE shop = ?").bind(shop).first();
  if (!row) return null;
  const methods = await rows(
    db,
    "SELECT method_id AS id, label, instructions FROM payment_methods WHERE shop = ? ORDER BY rowid",
    shop
  );
  return { shop, payment: { online: false, method: "offline", summary: row.summary, methods, never_in_chat: JSON.parse(row.never_in_chat_json || "[]"), flow: JSON.parse(row.flow_json), order_statuses: ["pending_payment", "payment_submitted", "paid", "shipped", "delivered", "returned"] } };
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

function orderShape(row, proofs) {
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
    created_at: row.created_at,
    updated_at: row.updated_at,
    proofs: proofs || [],
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
  return orderShape(row, proofs);
}

export async function createOrder(db, { shop, items, total, idempotencyKey, buyerNote }) {
  const existing = await db
    .prepare("SELECT id FROM orders WHERE idempotency_key = ?")
    .bind(idempotencyKey)
    .first();
  if (existing) return { existing: true, order: await getOrder(db, existing.id) };
  const now = new Date().toISOString();
  const id = `ord_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await db
    .prepare(
      "INSERT INTO orders (id, shop, items_json, subtotal_cny, shipping_cny, total_cny, status, idempotency_key, buyer_note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(id, shop, JSON.stringify(total.lines), total.subtotal_cny, total.shipping_cny, total.total_cny, "pending_payment", idempotencyKey, buyerNote || null, now, now)
    .run();
  return { existing: false, order: await getOrder(db, id) };
}

export async function addPaymentProof(db, { orderId, paymentMethod, transactionId, amountCny }) {
  const order = await getOrder(db, orderId);
  if (!order) return null;
  const now = new Date().toISOString();
  const id = `proof_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await db
    .prepare(
      "INSERT INTO payment_proofs (id, order_id, payment_method, transaction_id, amount_cny, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .bind(id, orderId, paymentMethod, transactionId, amountCny, now)
    .run();
  // NOTE: verification is SIMULATED for this demo — submitting a transaction
  // id marks the order paid. A real deployment must verify receipt first.
  await db
    .prepare("UPDATE orders SET status = 'paid', updated_at = ? WHERE id = ?")
    .bind(now, orderId)
    .run();
  return getOrder(db, orderId);
}
