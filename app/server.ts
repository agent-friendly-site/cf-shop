/**
 * Production Worker entry (Phase 5): HonoX file routes + code-mounted API.
 */
import { createApp } from "honox/server";
import { createApiApp } from "../src/api";
import { AUTO_COMPLETE_AFTER_DAYS, UNPAID_EXPIRY_MINUTES } from "../src/domain/constants";
import type { Env } from "../src/env";
import * as jobs from "../src/services/jobs";

// trailingSlash false: keep MCP/static paths (llms.txt, upload-proof) byte-stable.
const app = createApp({ trailingSlash: false });
app.route("/", createApiApp({ includeLegacyPages: false }));

async function scheduledJobs(env: Env) {
  const expired = await jobs.expireUnpaidOrders(env.DB, UNPAID_EXPIRY_MINUTES);
  console.log(`expire-unpaid: ${expired.length} orders auto-cancelled`, expired);
  const done = await jobs.autoCompleteShipped(env.DB, AUTO_COMPLETE_AFTER_DAYS);
  console.log(`auto-complete: ${done.length} orders completed`, done);
  return { expired, done };
}

export default {
  fetch: app.fetch.bind(app),
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(scheduledJobs(env));
  },
};
