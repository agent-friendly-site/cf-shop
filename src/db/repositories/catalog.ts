import { ORDER_STATUSES } from "../../domain/constants";
import { rows } from "../helpers";
import type { Product, Shop, ShopPolicies } from "../types";

export async function listShops(db: D1Database): Promise<Shop[]> {
  return rows<Shop>(db, "SELECT * FROM shops ORDER BY slug");
}

export async function getShop(db: D1Database, slug: string): Promise<Shop | null> {
  return (await db.prepare("SELECT * FROM shops WHERE slug = ?").bind(slug).first()) as Shop | null;
}

export async function listProducts(db: D1Database, shop: string): Promise<Product[]> {
  // rowid = seed insertion order, i.e. the source files' product order.
  return rows<Product>(db, "SELECT * FROM products WHERE shop = ? ORDER BY rowid", shop);
}

export async function getProduct(
  db: D1Database,
  shop: string,
  id: string,
): Promise<Product | null> {
  return (await db
    .prepare("SELECT * FROM products WHERE shop = ? AND id = ?")
    .bind(shop, id)
    .first()) as Product | null;
}

export async function getPolicies(db: D1Database, shop: string): Promise<ShopPolicies | null> {
  return (await db
    .prepare("SELECT * FROM shop_policies WHERE shop = ?")
    .bind(shop)
    .first()) as ShopPolicies | null;
}

export async function getPayment(db: D1Database, shop: string) {
  const row = (await db
    .prepare("SELECT * FROM shop_payment WHERE shop = ?")
    .bind(shop)
    .first()) as {
    summary: string;
    never_in_chat_json: string;
    flow_json: string;
  } | null;
  if (!row) return null;
  const methods = await rows<{ id: string; label: string; instructions: string }>(
    db,
    "SELECT method_id AS id, label, instructions FROM payment_methods WHERE shop = ? ORDER BY rowid",
    shop,
  );
  return {
    shop,
    payment: {
      online: false,
      method: "offline",
      summary: row.summary,
      methods,
      never_in_chat: JSON.parse(row.never_in_chat_json || "[]") as unknown[],
      flow: JSON.parse(row.flow_json) as unknown,
      order_statuses: ORDER_STATUSES,
    },
  };
}

export async function getRecommendations(db: D1Database, shop: string) {
  const recs = await rows<{
    product_id: string;
    best_for: string;
    why: string;
    alternative_if_out: string;
  }>(
    db,
    "SELECT product_id, best_for, why, alternative_if_out FROM recommendations WHERE shop = ? ORDER BY rank",
    shop,
  );
  const bundles = await rows<{ name: string; items_json: string; total_cny: number; note: string }>(
    db,
    "SELECT name, items_json, total_cny, note FROM shop_bundles WHERE shop = ? ORDER BY rowid",
    shop,
  );
  return {
    recs,
    bundles: bundles.map((b) => ({
      name: b.name,
      items: JSON.parse(b.items_json) as unknown,
      total_cny: b.total_cny,
      note: b.note,
    })),
  };
}
