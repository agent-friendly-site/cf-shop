import { defineConfig } from "drizzle-kit";

/**
 * Phase 2.1: schema-only config so `drizzle-kit check` can validate
 * `src/db/schema.ts`. Migration takeover (baseline + archive) is Phase 2.3.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
