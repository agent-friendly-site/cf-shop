/**
 * Admin service (Phase 3.x harden).
 * Key/session + product/policy/payment edits with validation.
 */
import * as adminRepo from "../db/repositories/admin";
import { DomainRpcError } from "../db/shared";

export {
  createAdminSession,
  deleteAdminSession,
  getSessionShop,
  setAdminKey,
  verifyAdminKey,
} from "../db/repositories/admin";

export async function updateProduct(
  db: D1Database,
  shop: string,
  id: string,
  { price, stock }: { price?: number; stock?: number },
) {
  const p = await adminRepo.getProduct(db, shop, id);
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
  return adminRepo.persistProductUpdate(db, shop, id, sets, params);
}

export async function updatePolicies(db: D1Database, shop: string, patch: Record<string, unknown>) {
  const pol = await adminRepo.getPolicies(db, shop);
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
  return adminRepo.persistPoliciesUpdate(db, shop, sets, params);
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
    await adminRepo.persistPaymentMethodInstructions(db, shop, m.id, m.instructions);
  }
  return adminRepo.getPayment(db, shop);
}
