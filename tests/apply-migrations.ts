import { applyD1Migrations, env } from "cloudflare:test";

// Apply all SQL migrations once per test file isolate so D1 matches production schema.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
