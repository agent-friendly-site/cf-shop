/**
 * Live MCP endpoint (Phase 4.2).
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Hono } from "hono";
import { createMcpServer } from "../mcp/server";
import { type AppEnv, notFound, shopOr404 } from "./helpers";

export function registerMcpRoutes(app: Hono<AppEnv>) {
  app.all("/shops/:shop/mcp", async (c) => {
    const slug = c.req.param("shop");
    const shop = await shopOr404(c, slug);
    if (!shop) return notFound(c, `unknown shop: ${slug}`);
    const transport = new WebStandardStreamableHTTPServerTransport();
    const server = createMcpServer(c.env, slug);
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
}
