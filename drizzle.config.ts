import { defineConfig } from "drizzle-kit";

/**
 * Phase 2.3: drizzle-kit owns schema diffs → SQL under ./drizzle.
 * Apply with: npx wrangler d1 migrations apply agent-friendly-orders --local
 * (or --remote after the production baseline has been marked applied;
 * see README “D1 migrations”).
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
