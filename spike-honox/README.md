# Phase 0b — HonoX spike

Validates the v2.0 frontend stack before Phase 5:

1. `createApp()` + `.route()` hybrid mount of API/MCP-shaped routes
2. React renderer (`@hono/react-renderer`) + React island hydration
3. Tailwind v4 + shadcn-style Dialog
4. Two-pass Vite build + Workers deploy

## Commands

```bash
cd spike-honox
npm install
npm run build
npx wrangler deploy   # deploys as agent-friendly-honox-spike (NOT production)
```

## Manual check

1. Open `/shops/bean-bloom/admin/`
2. Login with `spike-admin-key`
3. Open `ord_spike_001` → Confirm payment (80)
4. Also hit `POST /shops/bean-bloom/mcp` with `tools/list`
