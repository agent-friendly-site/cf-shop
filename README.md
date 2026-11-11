# agent-friendly-platform

The agent-friendly multi-merchant platform, hosted entirely on Cloudflare:
**one Hono Worker + one D1 database**. No more split between a GitHub Pages
static site and a separate MCP Worker.

Live: https://agent-friendly-platform.refined-x.workers.dev

- Agent-only storefronts at `/shops/:shop/` — no human shopping UI.
- Discovery: give an agent a shop URL; it reads `{shop}/llms.txt`, then
  `openapi.json`, `agent.json`, `api/products.json`, `policies.json`.
- Live MCP: `POST /shops/:shop/mcp` (Streamable HTTP, protocol 2025-06-18),
  8 tools: `list_products`, `get_product`, `recommend_products`,
  `calculate_total`, `create_order`, `submit_payment_proof`,
  `confirm_payment` (seller-side), `get_order`.
- Payment is offline: the seller provides payment instructions in the
  order confirmation, the buyer pays outside the agent, then submits the
  transaction id; the seller verifies within 24h and ships in 2 business
  days. Never send card numbers or verification codes in chat.

## Shops

| slug | shop | products |
|---|---|---|
| `bean-bloom` | Bean Bloom Coffee / 晨光咖啡 | Yirgacheffe 68, Cold Brew 88, Decaf 72 (out of stock) |
| `paper-lantern` | Paper Lantern Stationery / 纸灯文具 | Notebook 38, Gel pen 18, Washi tape 25 |
| `terra-pots` | Terra Pots Ceramics / 陶土手作 | Mug 128, Plate 98, Vase 158 |

Shipping flat 12 CNY, free over 200 CNY, 7-day returns (unused, buyer pays
return shipping). Prices and stock are the same as the GitHub Pages demo;
they were imported verbatim, not invented.

## Architecture

```
Cloudflare (the only deployment target)
└── Worker agent-friendly-platform (Hono, src/index.js)
    ├── static content: llms.txt, guide.md, starter-prompt.txt,
    │   openapi.json, agent.json, mcp.json (src/data, bundled)
    ├── D1-backed JSON: api/products.json, api/catalog.json,
    │   policies.json, api/payment.json, api/recommendations.json,
    │   api/presentation.json (llms.txt product lines and
    │   llms-full.txt are also rendered from D1)
    ├── live MCP: POST /shops/:shop/mcp
    │   (McpServer + WebStandardStreamableHTTPServerTransport,
    │   the SDK's own Hono example pattern; src/mcp.js)
    └── D1 agent-friendly-orders (migrations/, see below)
GitHub (this repo): code + seed data only. GitHub Pages is NOT used.
```

Why Hono: built for Workers (fast, tiny, no Node adapter), one app serves
static files, REST routes and MCP, middleware covers auth/rate-limit/CORS
later, `@hono/zod-openapi` can generate OpenAPI from code, and D1/R2/DO/
Queues all have first-class bindings. The MCP SDK's
`WebStandardStreamableHTTPServerTransport` is the Workers-compatible
transport; the server is created fresh per request (stateless).

## D1 schema

`migrations/0001_init.sql` creates: `shops`, `products`,
`shop_policies`, `payment_methods`, `shop_payment`, `recommendations`,
`shop_bundles`, `orders`, `payment_proofs`. `0002` adds
`shop_payment.never_in_chat_json` (values that must never be sent in chat).

Order status flow: `pending_payment` → `payment_submitted` → `paid` →
`shipped` → `delivered` (`returned` possible). `idempotency_key` is UNIQUE
on `orders`: replays return the original order instead of creating a
duplicate.

> **Seller verification is real, not simulated.** `submit_payment_proof`
> only moves an order to `payment_submitted`. The seller then checks the
> actual receipt (bank / WeChat / Alipay) and amount and calls the
> seller-side tool `confirm_payment` with `verified_amount_cny`; the amount
> must equal the order total, or the order stays `payment_submitted`. Only
> then does the order become `paid` and ship. `confirm_payment` has no
> seller authentication yet in this demo — that comes with the admin work
> (`/admin` + API-key auth); until then, treat it as a seller-only tool
> and do not expose it to buyers.

## Local development

```sh
npm install
npm run build          # esbuild -> dist/worker.mjs
npx wrangler dev       # local dev, local D1 from migrations/
```

To seed a local D1, or to re-seed the production D1, use the seed script
(it applies migrations/ in order, then imports src/data):

```sh
python3 scripts/seed.py <account-id> <database-id> [--migrate-order /tmp/do_order.json]
```

Re-import shop data from the GitHub Pages source (rewrites hosts, applies
the documented text fixes) and regenerate the bundled data module:

```sh
python3 scripts/import_data.py
python3 scripts/gen_data_module.py
```

## Deploy

Deployment is via the Cloudflare API helper, **not** `wrangler deploy`,
because wrangler cannot use the vault-stored API token:

```sh
npm run build
python3 ~/workspace/custom-connectors/custom.cloudflare/bin/cf.py worker-put \
  <account-id> agent-friendly-platform dist/worker.mjs \
  --d1-binding DB:<database-id>
python3 ~/workspace/custom-connectors/custom.cloudflare/bin/cf.py worker-subdomain \
  <account-id> agent-friendly-platform
```

Live at `https://agent-friendly-platform.refined-x.workers.dev`.
Account `b74b5f1383b4c12d7d98a26b462e7c22`, D1 `agent-friendly-orders`
`dd3c36b4-a260-4fc5-9da2-b9b06ccfb1cc`, workers.dev subdomain `refined-x`.
No custom domain yet (by Hall's choice).

## Tests

```sh
python3 tests/test_client.py [shop]   # MCP end-to-end (default terra-pots)
python3 tests/compare_routes.py       # every route vs GitHub Pages
```

MCP end-to-end (verified live 2026-11-11): initialize → protocol
2025-06-18, server `agent-friendly-platform 1.0.0`; tools/list → 7 tools;
`list_products` terra-pots → mug 128/15, plate 98/22, vase 158/8;
`recommend_products` (daily water/tea, budget 300) → first choice mug,
alternative plate; `calculate_total` mug x1 → `128 元 + 12 元运费 = 140 元`;
`create_order` mug x1 → order `ord_mwbmqj05ft5d`, 140, `pending_payment`;
`submit_payment_proof` (WeChat, test txn) → `paid`; `get_order` → `paid`
with 1 proof. **E2E PASS.** (That run used the old simulated flow. Since
1.1.0, `submit_payment_proof` only reaches `payment_submitted` and
`confirm_payment` is required — see the 1.1.0 test below.)

MCP end-to-end, seller verification (verified live 2026-11-11, v1.1.0,
`python3 tests/test_client.py`): tools/list → 8 tools; `create_order`
mug x1 → order `ord_mwbqmz0cy8ru`, 140, `pending_payment`;
`submit_payment_proof` (WeChat, test txn, 140) → `payment_submitted`;
`confirm_payment` with 100 → error, stays `payment_submitted`;
`confirm_payment` with 140 → `paid` (`verified_amount_cny` 140);
`get_order` → `paid` with 1 proof. **E2E PASS.** Pre-1.1.0 test orders
that were marked `paid` under the old simulated flow keep their `paid`
status with `verified_amount_cny` null — they were never seller-verified,
and the migration did not rewrite them.

## Migration notes (from GitHub Pages + agent-friendly-mcp)

- The old deployment was split: static JSON on GitHub Pages
  (`agent-friendly-site.github.io`) + MCP on Worker `agent-friendly-mcp`
  (catalog fetched live from Pages, orders in Durable Object `OrderStore`).
  This repo replaces both. The old Worker and Pages site are still live
  until switchover is approved; nothing here touches them.
- One Durable Object order existed (`ord_mwbm04jqn387`, terra-pots test
  order, paid, 1 WeChat proof). It was fetched via `get_order` on the old
  Worker and migrated into D1 with its original id/status/proofs. The DO
  has no list API, so no other orders could be enumerated; that test order
  was the only one known.
- `scripts/import_data.py` rewrites every URL from
  `agent-friendly-site.github.io` / `agent-friendly-mcp.refined-x.workers.dev`
  to this Worker, and fixes stale wording: duplicated sentences, "(no
  shipment)" / "(no returns processed)" notes, "Payment happens on the shop
  checkout page" (contradicts offline payment), "no product photos yet"
  (photos exist now), and the old "GitHub Pages is static-only" MCP notes.
  OpenAPI version bumped to 1.0.0.
- Route comparison vs GitHub Pages (`tests/compare_routes.py`, 56 routes):
  26 match exactly (after host normalization); the other 30 differ only by
  the fixes above, the 1.0.0 version bump, the live-MCP wording — and
  because live Pages is behind the local source files for `mcp.json`,
  `openapi.json`, `agent.json` and `llms.txt` (the local source already
  said "live MCP"; Pages still serves the pre-live text). No product,
  price, stock or policy fact differs. Two real bugs found by the
  comparison and fixed: `api/payment.json` was missing `never_in_chat`,
  and presentation stock status used `in_stock` for quantity 8 where the
  source says `low_stock` (thresholds now: 0 out_of_stock, 1–10 low_stock).
- D1 `/batch` endpoint returns 404 on this account, so `scripts/seed.py`
  executes statements one at a time via `/query`.

## What is NOT done yet (switchover, needs Hall's approval)

- Point the shops' `mcp.json` / `llms.txt` at this Worker and retire
  GitHub Pages. The old `agent-friendly-mcp` Worker and the Pages site
  are still the live ones agents see today.
- Custom domain (deferred by Hall).
- Seller verification of payment is now real (`confirm_payment`, see above);
  seller authentication for it is still future work (admin routes).
- Test with a real MCP client (Claude Code / Cursor); so far only the
  raw JSON-RPC client has been used.
- Seller admin routes (future: `/admin` + API-key auth middleware).
