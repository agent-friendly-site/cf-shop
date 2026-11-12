/**
 * Admin data access (Phase 3.x harden).
 * Key/session SQL + product/policy/payment updates (validation in services/admin).
 */
import { sha256Hex } from "../shared";
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

export async function persistProductUpdate(
  db: D1Database,
  shop: string,
  id: string,
  sets: string[],
  params: unknown[],
) {
  await db
    .prepare(`UPDATE products SET ${sets.join(", ")} WHERE shop = ? AND id = ?`)
    .bind(...params, shop, id)
    .run();
  return getProduct(db, shop, id);
}

export async function persistPoliciesUpdate(
  db: D1Database,
  shop: string,
  sets: string[],
  params: unknown[],
) {
  if (sets.length > 0) {
    await db
      .prepare(`UPDATE shop_policies SET ${sets.join(", ")} WHERE shop = ?`)
      .bind(...params, shop)
      .run();
  }
  return getPolicies(db, shop);
}

export async function persistPaymentMethodInstructions(
  db: D1Database,
  shop: string,
  methodId: string,
  instructions: string,
) {
  await db
    .prepare("UPDATE payment_methods SET instructions = ? WHERE shop = ? AND method_id = ?")
    .bind(instructions, shop, methodId)
    .run();
}

export { getPayment, getPolicies, getProduct };
