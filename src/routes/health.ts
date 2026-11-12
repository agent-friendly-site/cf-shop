/**
 * Platform discovery + health routes (Phase 4.1).
 */
import type { Hono } from "hono";
import * as catalog from "../services/catalog";
import { type AppEnv, BASE, dataJson, dataText, json, text, VERSION } from "./helpers";

export function registerHealthRoutes(app: Hono<AppEnv>) {
  app.get("/", (c) => text(c, dataText("index.html"), "text/html; charset=utf-8"));
  app.get("/llms.txt", (c) => text(c, dataText("llms.txt")));
  app.get("/llms-full.txt", (c) => text(c, dataText("llms-full.txt")));
  app.get("/robots.txt", (c) => text(c, dataText("robots.txt")));
  app.get("/sitemap.xml", (c) =>
    text(c, dataText("sitemap.xml"), "application/xml; charset=utf-8"),
  );
  app.get("/openapi.json", (c) => json(c, dataJson("openapi.json")));
  app.get("/.well-known/agent.json", (c) => json(c, dataJson("well-known-agent.json")));
  app.get("/health", (c) =>
    json(c, { status: "ok", service: "agent-friendly-platform", version: VERSION }),
  );

  app.get("/shops.json", async (c) => {
    const shops = await catalog.listShops(c.env.DB);
    return json(c, {
      platform: BASE,
      discovery:
        "GET {shop}/llms.txt, then {shop}/openapi.json, {shop}/agent.json, {shop}/api/products.json",
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
}
