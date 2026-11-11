# Archived hand-written D1 migrations (v1.x)

These SQL files (`0001`–`0005`) built the production `agent-friendly-orders`
schema before Phase 2.3. They are kept for history and for reading how the
live tables evolved; **do not apply them**.

From Phase 2.3 onward:

- Schema source of truth: `src/db/schema.ts`
- New SQL: `drizzle/` via `npx drizzle-kit generate`
- Apply: `npx wrangler d1 migrations apply agent-friendly-orders --local`
  (see root README “D1 migrations” for the production baseline note)
