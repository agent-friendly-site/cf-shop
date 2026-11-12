import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

const EXPECTED = [
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
];

async function mcpRpc(method: string, params?: Record<string, unknown>) {
  const res = await SELF.fetch("https://example.com/shops/bean-bloom/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "1",
      method,
      ...(params !== undefined ? { params } : {}),
    }),
  });
  const body = (await res.text()).trim();
  if (body.startsWith("event:") || body.includes("\ndata:")) {
    const dataLines = body.split("\n").filter((l) => l.startsWith("data:"));
    const parsed = dataLines.map((l) => JSON.parse(l.slice(5)));
    return { status: res.status, msg: parsed.length === 1 ? parsed[0] : parsed };
  }
  return { status: res.status, msg: JSON.parse(body) };
}

describe("MCP tools/list", () => {
  beforeAll(async () => {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO shops (slug, name, name_zh, category, description, currency)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind("bean-bloom", "Bean Bloom Coffee", "晨光咖啡", "coffee", "test", "CNY")
      .run();
  });

  it("exposes the 13 production tool names", async () => {
    await mcpRpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "phase4-test", version: "1.0" },
    });
    await SELF.fetch("https://example.com/shops/bean-bloom/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });

    const { status, msg } = await mcpRpc("tools/list");
    expect(status).toBe(200);
    const tools = (msg as { result?: { tools?: { name: string }[] } }).result?.tools || [];
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED].sort());
  });
});
