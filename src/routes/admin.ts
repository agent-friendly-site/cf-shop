// Seller admin: web UI + JSON API for one shop, behind a per-shop API key.
// Routes are registered on the Hono app by registerAdminRoutes(app).
// Auth: Authorization: Bearer <key> (verified against the SHA-256 hash in
// D1 shop_admin_keys), or the httpOnly session cookie set by /login
// (24h, token hash in admin_sessions). Plaintext keys are never stored.
// Admin routes are intentionally NOT listed in llms.txt / agent.json:
// the admin is for the human seller, not for buyers' agents.
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Order, ShopPolicies } from "../db/types";
import { toHttpError } from "../domain/errors";
import * as adminService from "../services/admin";
import * as catalog from "../services/catalog";
import * as orderService from "../services/orders";
import * as paymentService from "../services/payments";
import { type AppContext, type AppEnv, json } from "./helpers";
import { parseCookies, requireAdmin, unauthorized } from "./middleware";
import {
  cancelOrderBodySchema,
  confirmPaymentBodySchema,
  loginBodySchema,
  markShippedBodySchema,
  updatePoliciesBodySchema,
  updateProductBodySchema,
  zodErrorMessage,
} from "./schemas";

/**
 * Translate DomainError via toHttpError, but keep the legacy admin JSON
 * shape `{ error: string }` so the admin islands can read `error` flat.
 */
function adminCatch(c: AppContext, e: unknown) {
  const mapped = toHttpError(e);
  return json(c, { error: mapped.body.error.message }, mapped.status as ContentfulStatusCode);
}

async function rawBody(c: AppContext): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

function orderSummary(o: Order) {
  return {
    id: o.id,
    shop: o.shop,
    items: o.items,
    subtotal_cny: o.subtotal_cny,
    shipping_cny: o.shipping_cny,
    total_cny: o.total_cny,
    status: o.status,
    buyer_name: o.buyer_name,
    buyer_contact: o.buyer_contact,
    shipping_address: o.shipping_address,
    carrier: o.carrier,
    tracking_number: o.tracking_number,
    shipped_at: o.shipped_at,
    completed_at: o.completed_at,
    cancelled_at: o.cancelled_at,
    cancel_reason: o.cancel_reason,
    verified_amount_cny: o.verified_amount_cny,
    verified_at: o.verified_at,
    verification_note: o.verification_note,
    created_at: o.created_at,
    updated_at: o.updated_at,
    proofs: o.proofs,
    timeline: o.timeline,
  };
}

function policyShape(pol: ShopPolicies | null) {
  if (!pol) return null;
  return { ...pol, order_statuses: JSON.parse(pol.order_statuses || "[]") as unknown[] };
}

export type RegisterAdminOptions = {
  /** Kept for call-site compatibility; HTML GET is owned by HonoX. */
  includeLegacyPages?: boolean;
};

export function registerAdminRoutes(app: Hono<AppEnv>, _opts: RegisterAdminOptions = {}) {
  // Admin HTML is served by app/routes/.../admin (HonoX, no trailing slash).
  // Keep /admin/ bookmarks working under createApp({ trailingSlash: false }).
  app.get("/shops/:shop/admin/", (c) => c.redirect(`/shops/${c.req.param("shop")}/admin`, 301));

  const api = "/shops/:shop/admin/api";

  app.post(`${api}/login`, async (c) => {
    const slug = c.req.param("shop");
    const shop = await catalog.getShop(c.env.DB, slug);
    if (!shop) return json(c, { error: `unknown shop: ${slug}` }, 404);
    const parsed = loginBodySchema.safeParse(await rawBody(c));
    // Preserve legacy 401 "wrong admin key" for missing/empty/invalid key shapes.
    if (!parsed.success || !(await adminService.verifyAdminKey(c.env.DB, slug, parsed.data.key))) {
      return json(c, { error: "wrong admin key" }, 401);
    }
    const { token, expires } = await adminService.createAdminSession(c.env.DB, slug);
    const res = json(c, { shop: slug, expires });
    res.headers.set(
      "Set-Cookie",
      `af_admin=${token}; Path=/shops/${slug}/admin; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`,
    );
    return res;
  });

  app.post(`${api}/logout`, async (c) => {
    const slug = c.req.param("shop");
    await adminService.deleteAdminSession(c.env.DB, parseCookies(c).af_admin);
    const res = json(c, { ok: true });
    res.headers.set(
      "Set-Cookie",
      `af_admin=; Path=/shops/${slug}/admin; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    );
    return res;
  });

  app.get(`${api}/me`, async (c) => {
    const slug = c.req.param("shop");
    if (!(await requireAdmin(c, slug))) return unauthorized(c);
    return json(c, { shop: slug });
  });

  app.get(`${api}/orders`, async (c) => {
    const slug = c.req.param("shop");
    if (!(await requireAdmin(c, slug))) return unauthorized(c);
    const status = c.req.query("status") || undefined;
    const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "50", 10) || 50, 1), 200);
    const orders = await orderService.listOrders(c.env.DB, slug, { status, limit });
    const counts = await orderService.orderCounts(c.env.DB, slug);
    return json(c, { shop: slug, counts, orders: orders.map(orderSummary) });
  });

  app.get(`${api}/orders/:id`, async (c) => {
    const slug = c.req.param("shop");
    if (!(await requireAdmin(c, slug))) return unauthorized(c);
    const order = await orderService.getOrder(c.env.DB, c.req.param("id"));
    if (!order || order.shop !== slug) return json(c, { error: "unknown order" }, 404);
    return json(c, { order: orderSummary(order) });
  });

  // Proof image (v1.6.0): serve an image proof from private R2 storage.
  // Admin-only: the buyer's upload link is NOT enough to view it, and
  // the image is never served from a public URL.
  app.get(`${api}/orders/:id/proofs/:proofId/image`, async (c) => {
    const slug = c.req.param("shop");
    if (!(await requireAdmin(c, slug))) return unauthorized(c);
    const order = await orderService.getOrder(c.env.DB, c.req.param("id"));
    if (!order || order.shop !== slug) return json(c, { error: "unknown order" }, 404);
    const proof = (order.proofs || []).find((p) => p.id === c.req.param("proofId"));
    if (proof?.proof_type !== "image" || !proof.r2_key) {
      return json(c, { error: "no image proof" }, 404);
    }
    const obj = await c.env.PROOFS.get(proof.r2_key);
    if (!obj) return json(c, { error: "image not found" }, 404);
    return new Response(obj.body, {
      headers: {
        "Content-Type": obj.httpMetadata?.contentType || proof.mime_type || "image/jpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  });

  app.post(`${api}/orders/:id/confirm-payment`, async (c) => {
    const slug = c.req.param("shop");
    if (!(await requireAdmin(c, slug))) return unauthorized(c);
    const order = await orderService.getOrder(c.env.DB, c.req.param("id"));
    if (!order || order.shop !== slug) return json(c, { error: "unknown order" }, 404);
    const parsed = confirmPaymentBodySchema.safeParse(await rawBody(c));
    if (!parsed.success) return json(c, { error: zodErrorMessage(parsed.error) }, 400);
    try {
      const done = await paymentService.confirmPayment(c.env.DB, {
        orderId: order.id,
        verifiedAmountCny: parsed.data.verified_amount_cny,
        note: parsed.data.note,
      });
      return json(c, { order: done ? orderSummary(done) : null });
    } catch (e) {
      return adminCatch(c, e);
    }
  });

  app.post(`${api}/orders/:id/mark-shipped`, async (c) => {
    const slug = c.req.param("shop");
    if (!(await requireAdmin(c, slug))) return unauthorized(c);
    const order = await orderService.getOrder(c.env.DB, c.req.param("id"));
    if (!order || order.shop !== slug) return json(c, { error: "unknown order" }, 404);
    const parsed = markShippedBodySchema.safeParse(await rawBody(c));
    if (!parsed.success) return json(c, { error: zodErrorMessage(parsed.error) }, 400);
    try {
      const done = await orderService.markShipped(c.env.DB, {
        orderId: order.id,
        carrier: parsed.data.carrier,
        trackingNumber: parsed.data.tracking_number,
      });
      return json(c, { order: done ? orderSummary(done) : null });
    } catch (e) {
      return adminCatch(c, e);
    }
  });

  app.post(`${api}/orders/:id/cancel`, async (c) => {
    const slug = c.req.param("shop");
    if (!(await requireAdmin(c, slug))) return unauthorized(c);
    const order = await orderService.getOrder(c.env.DB, c.req.param("id"));
    if (!order || order.shop !== slug) return json(c, { error: "unknown order" }, 404);
    const parsed = cancelOrderBodySchema.safeParse(await rawBody(c));
    if (!parsed.success) return json(c, { error: zodErrorMessage(parsed.error) }, 400);
    try {
      const done = await orderService.cancelOrder(c.env.DB, {
        orderId: order.id,
        reason: parsed.data.reason,
        actor: "seller",
      });
      return json(c, { order: done ? orderSummary(done) : null });
    } catch (e) {
      return adminCatch(c, e);
    }
  });

  app.get(`${api}/products`, async (c) => {
    const slug = c.req.param("shop");
    if (!(await requireAdmin(c, slug))) return unauthorized(c);
    const products = await catalog.listProducts(c.env.DB, slug);
    return json(c, { shop: slug, products });
  });

  app.put(`${api}/products/:id`, async (c) => {
    const slug = c.req.param("shop");
    if (!(await requireAdmin(c, slug))) return unauthorized(c);
    const parsed = updateProductBodySchema.safeParse(await rawBody(c));
    if (!parsed.success) return json(c, { error: zodErrorMessage(parsed.error) }, 400);
    try {
      const p = await adminService.updateProduct(c.env.DB, slug, c.req.param("id"), {
        price: parsed.data.price_cny,
        stock: parsed.data.stock,
      });
      return json(c, { product: p });
    } catch (e) {
      return adminCatch(c, e);
    }
  });

  app.get(`${api}/policies`, async (c) => {
    const slug = c.req.param("shop");
    if (!(await requireAdmin(c, slug))) return unauthorized(c);
    const pol = await catalog.getPolicies(c.env.DB, slug);
    const payment = await catalog.getPayment(c.env.DB, slug);
    return json(c, { shop: slug, policies: policyShape(pol), payment: payment?.payment || null });
  });

  app.put(`${api}/policies`, async (c) => {
    const slug = c.req.param("shop");
    if (!(await requireAdmin(c, slug))) return unauthorized(c);
    const parsed = updatePoliciesBodySchema.safeParse(await rawBody(c));
    if (!parsed.success) return json(c, { error: zodErrorMessage(parsed.error) }, 400);
    const patch = parsed.data;
    try {
      const pol = await adminService.updatePolicies(c.env.DB, slug, patch);
      let payment = await catalog.getPayment(c.env.DB, slug);
      if (patch.payment_methods) {
        payment = await adminService.updatePaymentMethods(c.env.DB, slug, patch.payment_methods);
      }
      return json(c, { shop: slug, policies: policyShape(pol), payment: payment?.payment || null });
    } catch (e) {
      return adminCatch(c, e);
    }
  });
}
