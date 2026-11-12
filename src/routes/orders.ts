/**
 * Public order timeline (Phase 4.1).
 */
import type { Hono } from "hono";
import * as orders from "../services/orders";
import { type AppEnv, json, notFound, shopOr404 } from "./helpers";

export function registerOrderRoutes(app: Hono<AppEnv>) {
  app.get("/shops/:shop/api/orders/:id/events", async (c) => {
    const slug = c.req.param("shop");
    const shop = await shopOr404(c, slug);
    if (!shop) return notFound(c, `unknown shop: ${slug}`);
    const order = await orders.getOrder(c.env.DB, c.req.param("id"));
    if (!order || order.shop !== slug) return notFound(c, `unknown order: ${c.req.param("id")}`);
    const events = await orders.listOrderEvents(c.env.DB, order.id);
    return json(c, { shop: slug, order_id: order.id, status: order.status, events });
  });
}
