// agent-friendly-platform: the whole multi-merchant agent-first platform
// as one Hono Worker on Cloudflare Workers + D1.
//
//   https://agent-friendly-platform.refined-x.workers.dev
//
// One Worker serves everything the old split deployment served:
//   - platform discovery: /, /llms.txt, /llms-full.txt, /shops.json,
//     /openapi.json, /.well-known/agent.json, /robots.txt, /sitemap.xml
//   - per shop: /shops/:shop/ and every agent file under it
//     (llms.txt, llms-full.txt, openapi.json, agent.json, mcp.json,
//     guide.md, starter-prompt.txt, api/products.json, api/catalog.json,
//     policies.json, api/payment.json, api/recommendations.json,
//     api/presentation.json)
//   - live MCP: POST /shops/:shop/mcp (Streamable HTTP, protocol 2025-06-18)
//   - order events: GET /shops/:shop/api/orders/:id/events (public timeline)
//   - seller admin: /shops/:shop/admin/ (web UI + JSON API, per-shop key)
//   - daily scheduled job: auto-complete orders shipped 7+ days ago
//
// Data: products, policies, payment, recommendations and orders live in D1
// (see src/db.js). Static prose (llms.txt, guide.md, starter-prompt.txt,
// openapi.json, agent.json, mcp.json) lives in src/data and is bundled.
// llms.txt product lines and llms-full.txt are rendered from D1 so prices
// and stock can never go stale.
import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "./mcp.js";
import { registerAdminRoutes } from "./admin.js";
import * as db from "./db.js";
import { dataFile } from "./data.js";

const BASE = "https://agent-friendly-platform.refined-x.workers.dev";
const VERSION = "1.5.0";

const app = new Hono();

function text(c, body, type = "text/plain; charset=utf-8") {
  return c.text(body, 200, { "Content-Type": type });
}

function json(c, obj, status = 200) {
  return c.json(obj, status);
}

async function shopOr404(c, slug) {
  const shop = await db.getShop(c.env.DB, slug);
  if (!shop) return null;
  return shop;
}

function notFound(c, message) {
  return c.json({ error: message }, 404);
}

// --- platform routes ---
app.get("/", (c) => text(c, dataFile("index.html"), "text/html; charset=utf-8"));
app.get("/llms.txt", (c) => text(c, dataFile("llms.txt")));
app.get("/llms-full.txt", (c) => text(c, dataFile("llms-full.txt")));
app.get("/robots.txt", (c) => text(c, dataFile("robots.txt")));
app.get("/sitemap.xml", (c) => text(c, dataFile("sitemap.xml"), "application/xml; charset=utf-8"));
app.get("/openapi.json", (c) => json(c, dataFile("openapi.json")));
app.get("/.well-known/agent.json", (c) => json(c, dataFile("well-known-agent.json")));
app.get("/health", (c) => json(c, { status: "ok", service: "agent-friendly-platform", version: VERSION }));

app.get("/shops.json", async (c) => {
  const shops = await db.listShops(c.env.DB);
  return json(c, {
    platform: BASE,
    discovery: "GET {shop}/llms.txt, then {shop}/openapi.json, {shop}/agent.json, {shop}/api/products.json",
    shops: shops.map((s) => ({
      slug: s.slug,
      name: s.name,
      name_zh: s.name_zh,
      url: `${BASE}/shops/${s.slug}/`,
      llms_txt: `${BASE}/shops/${s.slug}/llms.txt`,
      category: s.category,
    })),
  });
});

// --- per-shop static files ---
app.get("/shops/:shop", (c) => c.redirect(`/shops/${c.req.param("shop")}/`, 301));
app.get("/shops/:shop/", async (c) => {
  const shop = await shopOr404(c, c.req.param("shop"));
  if (!shop) return notFound(c, `unknown shop: ${c.req.param("shop")}`);
  return text(c, dataFile(`shops/${shop.slug}/index.html`), "text/html; charset=utf-8");
});

function staticShopFile(rel, type) {
  return async (c) => {
    const slug = c.req.param("shop");
    const shop = await shopOr404(c, slug);
    if (!shop) return notFound(c, `unknown shop: ${slug}`);
    const file = dataFile(`shops/${slug}/${rel}`);
    if (file === undefined) return notFound(c, `no such file: ${rel}`);
    return typeof file === "string" ? text(c, file, type) : json(c, file);
  };
}

app.get("/shops/:shop/llms-full.txt", async (c) => {
  const slug = c.req.param("shop");
  const shop = await shopOr404(c, slug);
  if (!shop) return notFound(c, `unknown shop: ${slug}`);
  const products = await db.listProducts(c.env.DB, slug);
  const policies = await db.getPolicies(c.env.DB, slug);
  const lines = [`# ${shop.name} — full corpus`, ``, shop.description, ``, `## Products`];
  for (const p of products) {
    lines.push(
      `### ${p.name} (${p.name_zh})`,
      `- id: ${p.id}`,
      `- price: ${p.price} CNY`,
      `- stock: ${p.stock}`,
      `- ${p.description}`,
      ``
    );
  }
  lines.push(
    `## Policies`,
    `- Shipping: flat ${policies.shipping_flat_cny} CNY, free over ${policies.free_over_cny} CNY. Ships in ${policies.lead_time}.`,
    `- Returns: ${policies.returns_window_days} days, ${policies.returns_condition}, buyer pays return shipping.`,
    `- Privacy: ${policies.privacy}`
  );
  return text(c, lines.join("\n") + "\n");
});

app.get("/shops/:shop/llms.txt", async (c) => {
  const slug = c.req.param("shop");
  const shop = await shopOr404(c, slug);
  if (!shop) return notFound(c, `unknown shop: ${slug}`);
  const products = await db.listProducts(c.env.DB, slug);
  let template = dataFile(`shops/${slug}/llms.txt`);
  const start = template.indexOf("## What this shop sells\n");
  const end = template.indexOf("\n## How to interact", start);
  if (start !== -1 && end !== -1) {
    const lines =
      products
        .map((p) => `- ${p.name} — ${p.price} CNY, stock ${p.stock}. ${p.description}`)
        .join("\n") + "\n";
    template =
      template.slice(0, start + "## What this shop sells\n".length) +
      lines +
      template.slice(end);
  }
  return text(c, template);
});

app.get("/shops/:shop/index.html", staticShopFile("index.html", "text/html; charset=utf-8"));
app.get("/shops/:shop/openapi.json", staticShopFile("openapi.json", "application/json"));
app.get("/shops/:shop/agent.json", staticShopFile("agent.json", "application/json"));
app.get("/shops/:shop/mcp.json", staticShopFile("mcp.json", "application/json"));
app.get("/shops/:shop/guide.md", staticShopFile("guide.md", "text/markdown; charset=utf-8"));
app.get("/shops/:shop/starter-prompt.txt", staticShopFile("starter-prompt.txt"));
app.get("/shops/:shop/.well-known/agent.json", staticShopFile("well-known-agent.json", "application/json"));

// --- per-shop D1-backed JSON ---
app.get("/shops/:shop/api/products.json", async (c) => {
  const slug = c.req.param("shop");
  const shop = await shopOr404(c, slug);
  if (!shop) return notFound(c, `unknown shop: ${slug}`);
  const products = await db.listProducts(c.env.DB, slug);
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
  const products = await db.listProducts(c.env.DB, slug);
  return json(c, {
    shop: slug,
    name: shop.name,
    url: `${BASE}/shops/${slug}/`,
    currency: "CNY",
    products: products.map((p) => ({ id: p.id, name: p.name, price: p.price, currency: p.currency })),
  });
});

app.get("/shops/:shop/policies.json", async (c) => {
  const slug = c.req.param("shop");
  const shop = await shopOr404(c, slug);
  if (!shop) return notFound(c, `unknown shop: ${slug}`);
  const pol = await db.getPolicies(c.env.DB, slug);
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
  const payment = await db.getPayment(c.env.DB, slug);
  return json(c, payment);
});

app.get("/shops/:shop/api/recommendations.json", async (c) => {
  const slug = c.req.param("shop");
  const shop = await shopOr404(c, slug);
  if (!shop) return notFound(c, `unknown shop: ${slug}`);
  const tpl = dataFile(`shops/${slug}/api/recommendations.json`);
  const { recs, bundles } = await db.getRecommendations(c.env.DB, slug);
  const pairs = new Map((tpl.recommendations || []).map((r) => [r.product_id, r.pairs_with || []]));
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
  const tpl = dataFile(`shops/${slug}/api/presentation.json`);
  const products = await db.listProducts(c.env.DB, slug);
  return json(c, {
    ...tpl,
    products: products.map((p) => ({
      id: p.id,
      name: p.name_zh,
      name_en: p.name,
      price: { amount: p.price, currency: p.currency },
      // Same thresholds as the source IR: 0 = out_of_stock, 1-10 = low_stock.
      stock: { status: p.stock === 0 ? "out_of_stock" : p.stock <= 10 ? "low_stock" : "in_stock", quantity: p.stock },
      product_url: p.url,
      attributes: [{ key: "描述", value: p.description }],
      snippet: p.description,
      image_url: p.image_url || null,
      image_credit: p.image_credit || null,
    })),
  });
});

// --- per-shop order events (public read, order id is the credential) ---
app.get("/shops/:shop/api/orders/:id/events", async (c) => {
  const slug = c.req.param("shop");
  const shop = await shopOr404(c, slug);
  if (!shop) return notFound(c, `unknown shop: ${slug}`);
  const order = await db.getOrder(c.env.DB, c.req.param("id"));
  if (!order || order.shop !== slug) return notFound(c, `unknown order: ${c.req.param("id")}`);
  const events = await db.listOrderEvents(c.env.DB, order.id);
  return json(c, { shop: slug, order_id: order.id, status: order.status, events });
});

// --- seller admin: web UI + JSON API (API-key auth, see src/admin.js) ---
registerAdminRoutes(app);

// --- live MCP: POST /shops/:shop/mcp ---
app.all("/shops/:shop/mcp", async (c) => {
  const slug = c.req.param("shop");
  const shop = await shopOr404(c, slug);
  if (!shop) return notFound(c, `unknown shop: ${slug}`);
  const transport = new WebStandardStreamableHTTPServerTransport();
  const server = createMcpServer(c.env, slug);
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});

app.notFound((c) => notFound(c, `not found: ${c.req.path}`));

// Daily scheduled job (cron trigger, see wrangler.toml): auto-complete
// orders shipped more than 7 days ago with no buyer confirmation.
async function scheduledAutoComplete(env) {
  const done = await db.autoCompleteShipped(env.DB, db.AUTO_COMPLETE_AFTER_DAYS);
  console.log(`auto-complete: ${done.length} orders completed`, done);
  return done;
}

export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    ctx.waitUntil(scheduledAutoComplete(env));
  },
};
