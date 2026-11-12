import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Product } from "../../db/shared";
import { toMcpError } from "../../domain/errors";
import type { Env } from "../../env";
import * as catalog from "../../services/catalog";
import * as orders from "../../services/orders";
import { ItemShape, mcpText, publicProduct } from "../shared";

export function registerCatalogTools(server: McpServer, env: Env, shop: string) {
  server.registerTool(
    "list_products",
    {
      title: "List products",
      description: "List all products of this shop with price, currency and stock.",
      inputSchema: {},
    },
    async () => {
      try {
        const products = await catalog.listProducts(env.DB, shop);
        return mcpText({ shop, currency: "CNY", products: products.map(publicProduct) });
      } catch (e) {
        return toMcpError(e);
      }
    },
  );

  server.registerTool(
    "get_product",
    {
      title: "Get product",
      description: "Get one product by id.",
      inputSchema: { product_id: z.string() },
    },
    async ({ product_id }) => {
      try {
        const p = await catalog.getProduct(env.DB, shop, product_id);
        if (!p) throw new Error(`unknown product_id: ${product_id}`);
        return mcpText({ shop, product: publicProduct(p) });
      } catch (e) {
        return toMcpError(e);
      }
    },
  );

  server.registerTool(
    "recommend_products",
    {
      title: "Recommend products",
      description:
        "Recommend 1 first choice + 1 alternative for a use / budget, with reasons. Uses the shop's own recommendations.",
      inputSchema: { use: z.string().optional(), budget_cny: z.number().optional() },
    },
    async ({ use, budget_cny }) => {
      try {
        const products = await catalog.listProducts(env.DB, shop);
        const { recs } = await catalog.getRecommendations(env.DB, shop);
        const rank = new Map(recs.map((r, i) => [r.product_id, i]));
        let ordered = products
          .filter((p) => p.stock > 0)
          .sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99));
        if (budget_cny) ordered = ordered.filter((p) => p.price <= budget_cny);
        const first = ordered[0] || null;
        const alt = ordered[1] || null;
        const why = (p: Product) => recs.find((r) => r.product_id === p.id) || null;
        const withWhy = (p: Product | null) =>
          p ? { ...publicProduct(p), best_for: why(p)?.best_for, why: why(p)?.why } : null;
        return mcpText({
          shop,
          use: use || null,
          budget_cny: budget_cny ?? null,
          first_choice: withWhy(first),
          alternative: withWhy(alt),
          note: "首选 1 个 + 备选 1 个；先问用途再推荐；总价按 calculate_total 算。",
        });
      } catch (e) {
        return toMcpError(e);
      }
    },
  );

  server.registerTool(
    "calculate_total",
    {
      title: "Calculate total",
      description: "Calculate subtotal, shipping (12 CNY, free over 200 CNY) and total for items.",
      inputSchema: { items: z.array(ItemShape) },
    },
    async ({ items }) => {
      try {
        const products = await catalog.listProducts(env.DB, shop);
        const t = orders.totals(items || [], products);
        return mcpText({ shop, ...t });
      } catch (e) {
        return toMcpError(e);
      }
    },
  );
}
