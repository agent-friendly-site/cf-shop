// agent-friendly-platform: the whole multi-merchant agent-first platform
// as one Hono Worker on Cloudflare Workers + D1.
//
// Phase 4: access layer is routes/ + mcp/; scheduled jobs stay here.

import { Hono } from "hono";
import { AUTO_COMPLETE_AFTER_DAYS, UNPAID_EXPIRY_MINUTES } from "./domain/constants";
import type { Env } from "./env";
import { registerAdminRoutes } from "./routes/admin";
import { registerHealthRoutes } from "./routes/health";
import { type AppEnv, notFound } from "./routes/helpers";
import { registerMcpRoutes } from "./routes/mcp";
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
registerMcpRoutes(app);

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
