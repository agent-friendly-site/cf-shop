/**
 * Per-shop static files + D1-backed JSON (Phase 4.1).
 */
import type { Hono } from "hono";
import * as catalog from "../services/catalog";
import { dataFile } from "../data";
import {
  type AppContext,
  type AppEnv,
  BASE,
  dataJson,
  dataText,
  json,
  notFound,
  shopOr404,
  text,
} from "./helpers";

function staticShopFile(rel: string, type = "text/plain; charset=utf-8") {
  return async (c: AppContext) => {
    const slug = c.req.param("shop") ?? "";
    const shop = await shopOr404(c, slug);
    if (!shop) return notFound(c, `unknown shop: ${slug}`);
    const file = dataFile(`shops/${slug}/${rel}`);
    if (file === undefined) return notFound(c, `no such file: ${rel}`);
    return typeof file === "string" ? text(c, file, type) : json(c, file);
  };
}

export function registerShopRoutes(app: Hono<AppEnv>) {
  app.get("/shops/:shop", (c) => c.redirect(`/shops/${c.req.param("shop")}/`, 301));
  app.get("/shops/:shop/", async (c) => {
    const shop = await shopOr404(c, c.req.param("shop"));
    if (!shop) return notFound(c, `unknown shop: ${c.req.param("shop")}`);
    return text(c, dataText(`shops/${shop.slug}/index.html`), "text/html; charset=utf-8");
  });

  app.get("/shops/:shop/llms-full.txt", async (c) => {
    const slug = c.req.param("shop");
    const shop = await shopOr404(c, slug);
    if (!shop) return notFound(c, `unknown shop: ${slug}`);
    const products = await catalog.listProducts(c.env.DB, slug);
    const policies = await catalog.getPolicies(c.env.DB, slug);
    if (!policies) return notFound(c, `no policies for shop: ${slug}`);
    const lines = [`# ${shop.name} — full corpus`, ``, shop.description, ``, `## Products`];
    for (const p of products) {
      lines.push(
        `### ${p.name} (${p.name_zh})`,
        `- id: ${p.id}`,
        `- price: ${p.price} CNY`,
        `- stock: ${p.stock}`,
        `- ${p.description}`,
        ``,
      );
    }
    lines.push(
      `## Policies`,
      `- Shipping: flat ${policies.shipping_flat_cny} CNY, free over ${policies.free_over_cny} CNY. Ships in ${policies.lead_time}.`,
      `- Returns: ${policies.returns_window_days} days, ${policies.returns_condition}, buyer pays return shipping.`,
      `- Privacy: ${policies.privacy}`,
    );
    return text(c, `${lines.join("\n")}\n`);
  });

  app.get("/shops/:shop/llms.txt", async (c) => {
    const slug = c.req.param("shop");
    const shop = await shopOr404(c, slug);
    if (!shop) return notFound(c, `unknown shop: ${slug}`);
    const products = await catalog.listProducts(c.env.DB, slug);
    let template = dataText(`shops/${slug}/llms.txt`);
    const start = template.indexOf("## What this shop sells\n");
    const end = template.indexOf("\n## How to interact", start);
    if (start !== -1 && end !== -1) {
      const lines = `${products
        .map((p) => `- ${p.name} — ${p.price} CNY, stock ${p.stock}. ${p.description}`)
        .join("\n")}\n`;
      template =
        template.slice(0, start + "## What this shop sells\n".length) + lines + template.slice(end);
    }
    return text(c, template);
  });

  app.get("/shops/:shop/index.html", staticShopFile("index.html", "text/html; charset=utf-8"));
  app.get("/shops/:shop/openapi.json", staticShopFile("openapi.json", "application/json"));
  app.get("/shops/:shop/agent.json", staticShopFile("agent.json", "application/json"));
  app.get("/shops/:shop/mcp.json", staticShopFile("mcp.json", "application/json"));
  app.get("/shops/:shop/guide.md", staticShopFile("guide.md", "text/markdown; charset=utf-8"));
  app.get("/shops/:shop/starter-prompt.txt", staticShopFile("starter-prompt.txt"));
  app.get(
    "/shops/:shop/.well-known/agent.json",
    staticShopFile("well-known-agent.json", "application/json"),
  );

  app.get("/shops/:shop/api/products.json", async (c) => {
    const slug = c.req.param("shop");
    const shop = await shopOr404(c, slug);
    if (!shop) return notFound(c, `unknown shop: ${slug}`);
    const products = await catalog.listProducts(c.env.DB, slug);
    return json(c, {
      shop: slug,
      name: shop.name,
      url: `${BASE}/shops/${slug}/`,
      currency: "CNY",
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        name_zh: p.name_zh,
        price: p.price,
        currency: p.currency,
        stock: p.stock,
        description: p.description,
        url: p.url,
        image_url: p.image_url || null,
        image_credit: p.image_credit || null,
      })),
    });
  });

  app.get("/shops/:shop/api/catalog.json", async (c) => {
    const slug = c.req.param("shop");
    const shop = await shopOr404(c, slug);
    if (!shop) return notFound(c, `unknown shop: ${slug}`);
    const products = await catalog.listProducts(c.env.DB, slug);
    return json(c, {
      shop: slug,
      name: shop.name,
      url: `${BASE}/shops/${slug}/`,
      currency: "CNY",
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        currency: p.currency,
      })),
    });
  });

  app.get("/shops/:shop/policies.json", async (c) => {
    const slug = c.req.param("shop");
    const shop = await shopOr404(c, slug);
    if (!shop) return notFound(c, `unknown shop: ${slug}`);
    const pol = await catalog.getPolicies(c.env.DB, slug);
    if (!pol) return notFound(c, `no policies for shop: ${slug}`);
    return json(c, {
      shop: slug,
      shipping: {
        flat_fee_cny: pol.shipping_flat_cny,
        free_over_cny: pol.free_over_cny,
        lead_time: pol.lead_time,
      },
      returns: {
        window_days: pol.returns_window_days,
        condition: pol.returns_condition,
        return_shipping: pol.return_shipping,
      },
      privacy: pol.privacy,
      payment: `${BASE}/shops/${slug}/api/payment.json`,
      order_statuses: JSON.parse(pol.order_statuses),
    });
  });

  app.get("/shops/:shop/api/payment.json", async (c) => {
    const slug = c.req.param("shop");
    const shop = await shopOr404(c, slug);
    if (!shop) return notFound(c, `unknown shop: ${slug}`);
    const payment = await catalog.getPayment(c.env.DB, slug);
    return json(c, payment);
  });

  app.get("/shops/:shop/api/recommendations.json", async (c) => {
    const slug = c.req.param("shop");
    const shop = await shopOr404(c, slug);
    if (!shop) return notFound(c, `unknown shop: ${slug}`);
    const tpl = dataJson(`shops/${slug}/api/recommendations.json`);
    const { recs, bundles } = await catalog.getRecommendations(c.env.DB, slug);
    const tplRecs =
      (tpl.recommendations as { product_id: string; pairs_with?: string[] }[] | undefined) || [];
    const pairs = new Map(tplRecs.map((r) => [r.product_id, r.pairs_with || []]));
    return json(c, {
      ...tpl,
      recommendations: recs.map((r) => ({
        product_id: r.product_id,
        best_for: r.best_for,
        why: r.why,
        pairs_with: pairs.get(r.product_id) || [],
        alternative_if_out: r.alternative_if_out,
      })),
      bundles,
    });
  });

  app.get("/shops/:shop/api/presentation.json", async (c) => {
    const slug = c.req.param("shop");
    const shop = await shopOr404(c, slug);
    if (!shop) return notFound(c, `unknown shop: ${slug}`);
    const tpl = dataJson(`shops/${slug}/api/presentation.json`);
    const products = await catalog.listProducts(c.env.DB, slug);
    return json(c, {
      ...tpl,
      products: products.map((p) => ({
        id: p.id,
        name: p.name_zh,
        name_en: p.name,
        price: { amount: p.price, currency: p.currency },
        stock: {
          status: p.stock === 0 ? "out_of_stock" : p.stock <= 10 ? "low_stock" : "in_stock",
          quantity: p.stock,
        },
        product_url: p.url,
        attributes: [{ key: "描述", value: p.description }],
        snippet: p.description,
        image_url: p.image_url || null,
        image_credit: p.image_credit || null,
      })),
    });
  });
}
