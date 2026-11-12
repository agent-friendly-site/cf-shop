/**
 * Code-mounted API / shop / MCP routes (Phase 5).
 * HTML for admin + upload GET is owned by HonoX file routes when using app/server.ts.
 * Vitest keeps includeLegacyPages so SELF.fetch still hits the old HTML without Vite.
 */
import { Hono } from "hono";
import { registerAdminRoutes } from "./routes/admin";
import { registerHealthRoutes } from "./routes/health";
import { type AppEnv, notFound } from "./routes/helpers";
import { registerMcpRoutes } from "./routes/mcp";
import { registerOrderRoutes } from "./routes/orders";
import { registerShopRoutes } from "./routes/shop";
import { registerProofUploadRoutes } from "./routes/upload";

export type CreateApiAppOptions = {
  /** Vitest-only: plain-text GET for upload-proof token rejection tests. */
  includeLegacyPages?: boolean;
};

export function createApiApp(opts: CreateApiAppOptions = {}) {
  const includeLegacyPages = opts.includeLegacyPages ?? false;
  const app = new Hono<AppEnv>();

  registerHealthRoutes(app);
  registerShopRoutes(app);
  registerOrderRoutes(app);
  registerProofUploadRoutes(app, { includeLegacyPages });
  registerAdminRoutes(app, { includeLegacyPages });
  registerMcpRoutes(app);

  app.notFound((c) => notFound(c, `not found: ${c.req.path}`));
  return app;
}
