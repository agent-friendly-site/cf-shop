import { DomainRpcError, sha256Hex } from "../shared";
import { getPayment, getPolicies, getProduct } from "./catalog";

export async function setAdminKey(db: D1Database, shop: string, keyHash: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO shop_admin_keys (shop, key_hash, created_at) VALUES (?, ?, ?) ON CONFLICT(shop) DO UPDATE SET key_hash = excluded.key_hash, created_at = excluded.created_at, last_used_at = NULL",
    )
    .bind(shop, keyHash, now)
    .run();
}

export async function verifyAdminKey(db: D1Database, shop: string, key: string): Promise<boolean> {
  const row = (await db
    .prepare("SELECT key_hash FROM shop_admin_keys WHERE shop = ?")
    .bind(shop)
    .first()) as {
    key_hash: string;
  } | null;
  if (!row) return false;
  const hash = await sha256Hex(key);
  if (hash !== row.key_hash) return false;
  await db
    .prepare("UPDATE shop_admin_keys SET last_used_at = ? WHERE shop = ?")
    .bind(new Date().toISOString(), shop)
    .run();
  return true;
}

export async function createAdminSession(db: D1Database, shop: string) {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await db
    .prepare(
      "INSERT INTO admin_sessions (token_hash, shop, created_at, expires_at) VALUES (?, ?, ?, ?)",
    )
    .bind(await sha256Hex(token), shop, now, expires)
    .run();
  return { token, expires };
}

export async function getSessionShop(db: D1Database, token: string): Promise<string | null> {
  if (!token) return null;
  const row = (await db
    .prepare("SELECT shop, expires_at FROM admin_sessions WHERE token_hash = ?")
    .bind(await sha256Hex(token))
    .first()) as { shop: string; expires_at: string } | null;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row.shop;
}

export async function deleteAdminSession(db: D1Database, token: string): Promise<void> {
  if (!token) return;
  await db
    .prepare("DELETE FROM admin_sessions WHERE token_hash = ?")
    .bind(await sha256Hex(token))
    .run();
}

export async function updateProduct(
  db: D1Database,
  shop: string,
  id: string,
  { price, stock }: { price?: number; stock?: number },
) {
  const p = await getProduct(db, shop, id);
  if (!p) {
    throw new DomainRpcError(`unknown product_id: ${id}`, -32602);
  }
  const sets: string[] = [];
  const params: unknown[] = [];
  if (price !== undefined) {
    if (typeof price !== "number" || price < 0) {
      throw new DomainRpcError("price_cny must be a non-negative number", -32602);
    }
    sets.push("price = ?");
    params.push(price);
  }
  if (stock !== undefined) {
    if (!Number.isInteger(stock) || stock < 0) {
      throw new DomainRpcError("stock must be a non-negative integer", -32602);
    }
    sets.push("stock = ?");
    params.push(stock);
  }
  if (sets.length === 0) {
    throw new DomainRpcError("nothing to update: send price_cny and/or stock", -32602);
  }
  params.push(shop, id);
  await db
    .prepare(`UPDATE products SET ${sets.join(", ")} WHERE shop = ? AND id = ?`)
    .bind(...params)
    .run();
  return getProduct(db, shop, id);
}

export async function updatePolicies(db: D1Database, shop: string, patch: Record<string, unknown>) {
  const pol = await getPolicies(db, shop);
  if (!pol) {
    throw new DomainRpcError(`unknown shop: ${shop}`, -32602);
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
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, col] of Object.entries(map)) {
    if (patch[key] !== undefined) {
      sets.push(`${col} = ?`);
      params.push(patch[key]);
    }
  }
  if (sets.length > 0) {
    params.push(shop);
    await db
      .prepare(`UPDATE shop_policies SET ${sets.join(", ")} WHERE shop = ?`)
      .bind(...params)
      .run();
  }
  return getPolicies(db, shop);
}

export async function updatePaymentMethods(
  db: D1Database,
  shop: string,
  methods: { id: string; instructions: string }[] | undefined,
) {
  // methods: [{id, instructions}] — only instructions are editable.
  for (const m of methods || []) {
    if (!m.id || typeof m.instructions !== "string") {
      throw new DomainRpcError("each payment method needs id and instructions", -32602);
    }
    await db
      .prepare("UPDATE payment_methods SET instructions = ? WHERE shop = ? AND method_id = ?")
      .bind(m.instructions, shop, m.id)
      .run();
  }
  return getPayment(db, shop);
}
