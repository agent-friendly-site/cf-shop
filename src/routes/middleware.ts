/**
 * Auth helpers for admin API and proof-upload links (Phase 4.3).
 */
import * as admin from "../services/admin";
import * as payments from "../services/payments";
import { type AppContext, json } from "./helpers";

export function parseCookies(c: AppContext): Record<string, string> {
  const out: Record<string, string> = {};
  const header = c.req.header("Cookie") || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** True when Bearer key or af_admin session cookie authenticates for `shop`. */
export async function requireAdmin(c: AppContext, shop: string): Promise<boolean> {
  const auth = c.req.header("Authorization") || "";
  if (auth.startsWith("Bearer ")) {
    if (await admin.verifyAdminKey(c.env.DB, shop, auth.slice(7))) return true;
  }
  const token = parseCookies(c).af_admin;
  if (token && (await admin.getSessionShop(c.env.DB, token)) === shop) return true;
  return false;
}

export function unauthorized(c: AppContext) {
  return json(c, { error: "admin authentication required: log in with the shop admin key" }, 401);
}

/** Validate one-time proof-upload token; returns row or null. */
export async function requireProofUploadToken(
  c: AppContext,
  { shop, orderId, token }: { shop: string; orderId: string; token: string },
) {
  return payments.verifyProofUploadToken(c.env.DB, { shop, orderId, token });
}
