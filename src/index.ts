// Vitest worker entry: Hono app only (no `scheduled` — that lives on app/server.ts
// for production, so @hono/vite-build does not see two scheduled handlers).

import { createApiApp } from "./api";

const app = createApiApp({ includeLegacyPages: true });

export default app;
