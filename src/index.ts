// agent-friendly-platform: the whole multi-merchant agent-first platform
// as one Hono Worker on Cloudflare Workers + D1.
//
// Phase 4.1/4.3: routes/ holds health/shop/orders/admin/upload + middleware.
// MCP still top-level until Phase 4.2.

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { AUTO_COMPLETE_AFTER_DAYS, UNPAID_EXPIRY_MINUTES } from "./domain/constants";
import type { Env } from "./env";
import { createMcpServer } from "./mcp";
import { registerAdminRoutes } from "./routes/admin";
import { registerHealthRoutes } from "./routes/health";
import { type AppEnv, notFound, shopOr404 } from "./routes/helpers";
import { registerOrderRoutes } from "./routes/orders";
import { registerShopRoutes } from "./routes/shop";
import { registerProofUploadRoutes } from "./routes/upload";
import * as jobs from "./services/jobs";

const app = new Hono<AppEnv>();

registerHealthRoutes(app);
registerShopRoutes(app);
registerOrderRoutes(app);
registerProofUploadRoutes(app);
registerAdminRoutes(app);

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

async function scheduledJobs(env: Env) {
  const expired = await jobs.expireUnpaidOrders(env.DB, UNPAID_EXPIRY_MINUTES);
  console.log(`expire-unpaid: ${expired.length} orders auto-cancelled`, expired);
  const done = await jobs.autoCompleteShipped(env.DB, AUTO_COMPLETE_AFTER_DAYS);
  console.log(`auto-complete: ${done.length} orders completed`, done);
  return { expired, done };
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(scheduledJobs(env));
  },
};
