/**
 * Online smoke for agent-friendly-platform (post-deploy).
 * Usage: npm run test:smoke
 * Override base: SMOKE_BASE=https://... npx tsx tests/smoke.ts
 */
const BASE =
  process.env.SMOKE_BASE?.replace(/\/$/, "") ||
  "https://agent-friendly-platform.refined-x.workers.dev";
const SHOP = process.env.SMOKE_SHOP || "bean-bloom";
const UA = "Mozilla/5.0 (agent-friendly-platform-test)";

const EXPECTED_TOOLS = [
  "list_products",
  "get_product",
  "recommend_products",
  "calculate_total",
  "create_order",
  "submit_payment_proof",
  "get_payment_proof_upload_link",
  "confirm_payment",
  "get_order",
  "mark_shipped",
  "confirm_receipt",
  "cancel_order",
  "update_buyer_info",
] as const;

const EXPECTED_TOOL_NAMES = [...EXPECTED_TOOLS].sort().join(",");

type Json = Record<string, unknown>;

const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
  "User-Agent": UA,
} as const;

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg: string) {
  console.log(`OK: ${msg}`);
}

async function get(path: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    headers: { "User-Agent": UA },
  });
}

function parseMcpBody(body: string): Json {
  const trimmed = body.trim();
  if (trimmed.startsWith("event:") || trimmed.includes("\ndata:")) {
    const parsed = trimmed
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => JSON.parse(l.slice(5)) as Json);
    return (parsed.length === 1 ? parsed[0] : parsed.at(-1)) as Json;
  }
  return JSON.parse(trimmed) as Json;
}

async function postMcp(body: Record<string, unknown>): Promise<Response> {
  return fetch(`${BASE}/shops/${SHOP}/mcp`, {
    method: "POST",
    headers: MCP_HEADERS,
    body: JSON.stringify(body),
  });
}

async function mcpRpc(method: string, params?: Record<string, unknown>): Promise<Json> {
  const res = await postMcp({
    jsonrpc: "2.0",
    id: method,
    method,
    ...(params !== undefined ? { params } : {}),
  });
  if (!res.ok) fail(`MCP ${method} HTTP ${res.status}`);
  return parseMcpBody(await res.text());
}

async function main() {
  console.log(`smoke base=${BASE} shop=${SHOP}`);

  const healthRes = await get("/health");
  if (!healthRes.ok) fail(`/health HTTP ${healthRes.status}`);
  const health = (await healthRes.json()) as { status?: string };
  if (health.status !== "ok") fail(`/health status=${JSON.stringify(health)}`);
  ok("/health");

  const llmsRes = await get(`/shops/${SHOP}/llms.txt`);
  if (!llmsRes.ok) fail(`/shops/${SHOP}/llms.txt HTTP ${llmsRes.status}`);
  const llms = await llmsRes.text();
  if (!llms.trim()) fail("llms.txt empty");
  ok(`llms.txt (${llms.trim().length} bytes)`);

  await mcpRpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "agent-friendly-platform-smoke", version: "1.0" },
  });
  await postMcp({ jsonrpc: "2.0", method: "notifications/initialized" });

  const listed = await mcpRpc("tools/list");
  const tools = (listed.result as { tools?: { name: string }[] } | undefined)?.tools || [];
  const names = tools.map((t) => t.name).sort();
  if (names.length !== 13 || names.join(",") !== EXPECTED_TOOL_NAMES) {
    fail(`tools/list expected 13 names, got (${names.length}): ${names.join(", ")}`);
  }
  ok(`tools/list (${names.length})`);

  const adminRes = await get(`/shops/${SHOP}/admin`);
  if (!adminRes.ok) fail(`/shops/${SHOP}/admin HTTP ${adminRes.status}`);
  const adminHtml = await adminRes.text();
  if (!adminHtml.includes("admin-shell")) {
    fail("admin HTML missing admin-shell island marker");
  }
  ok("admin HTML has admin-shell");

  const productsRes = await get(`/shops/${SHOP}/api/products.json`);
  if (!productsRes.ok) fail(`/shops/${SHOP}/api/products.json HTTP ${productsRes.status}`);
  const productsBody = (await productsRes.json()) as {
    products?: { id?: string }[];
  };
  const productIds = (productsBody.products || []).map((p) => p.id).filter(Boolean);
  if (!productIds.includes("bb-yirg-250")) {
    fail(`products.json missing bb-yirg-250; got ${productIds.join(", ") || "(empty)"}`);
  }
  ok(`api/products.json (${productIds.length} products)`);

  console.log("smoke passed");
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
