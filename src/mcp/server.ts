// MCP server factory: one McpServer per shop, per request (stateless).
// Phase 4.2: tools live in mcp/tools/*; descriptions must stay verbatim.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../env";
import { registerCatalogTools } from "./tools/catalog";
import { registerOrderTools } from "./tools/orders";
import { registerPaymentTools } from "./tools/payments";
import { registerShippingTools } from "./tools/shipping";

export type McpServerOptions = {
  /** Public origin for proof-upload links (from the incoming request). */
  publicOrigin: string;
};

export function createMcpServer(env: Env, shop: string, opts: McpServerOptions) {
  const server = new McpServer({
    name: "agent-friendly-platform",
    version: "2.0.0",
  });

  registerCatalogTools(server, env, shop);
  registerOrderTools(server, env, shop, opts.publicOrigin);
  registerPaymentTools(server, env, shop, opts.publicOrigin);
  registerShippingTools(server, env, shop);

  return server;
}
