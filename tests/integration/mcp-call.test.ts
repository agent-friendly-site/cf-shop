import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

const SHOP = "bean-bloom";

async function mcpRpc(method: string, params?: Record<string, unknown>) {
  const res = await SELF.fetch(`https://example.com/shops/${SHOP}/mcp`, {
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

async function toolsCall(name: string, args: Record<string, unknown>) {
  return mcpRpc("tools/call", { name, arguments: args });
}

function toolText(msg: unknown): string {
  const content = (msg as { result?: { content?: { type: string; text: string }[] } }).result
    ?.content;
  return content?.map((c) => c.text).join("\n") || "";
}

describe("MCP tools/call", () => {
  beforeAll(async () => {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO shops (slug, name, name_zh, category, description, currency)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(SHOP, "Bean Bloom Coffee", "晨光咖啡", "coffee", "test", "CNY")
      .run();
    await env.DB.prepare(
      `INSERT OR REPLACE INTO products
        (id, shop, name, name_zh, price, currency, stock, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind("bb-yirg-250", SHOP, "Yirgacheffe", "耶加雪菲", 68, "CNY", 20, "test")
      .run();

    await mcpRpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "mcp-call-test", version: "1.0" },
    });
    await SELF.fetch(`https://example.com/shops/${SHOP}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
  });

  it("rejects create_order without shipping_address", async () => {
    const { status, msg } = await toolsCall("create_order", {
      items: [{ product_id: "bb-yirg-250", quantity: 1 }],
      idempotency_key: `idem-mcp-no-addr-${Date.now()}`,
    });
    expect(status).toBe(200);
    // Zod / MCP may surface as isError or JSON-RPC error; either is a rejection.
    const asObj = msg as {
      result?: { isError?: boolean; content?: { text: string }[] };
      error?: { message?: string };
    };
    const errText =
      asObj.result?.content?.map((c) => c.text).join(" ") || asObj.error?.message || "";
    expect(
      asObj.result?.isError === true || Boolean(asObj.error) || /shipping/i.test(errText),
    ).toBe(true);
  });

  it("create_order → get_order → cancel_order happy path", async () => {
    const idem = `idem-mcp-happy-${Date.now()}`;
    const created = await toolsCall("create_order", {
      items: [{ product_id: "bb-yirg-250", quantity: 1 }],
      idempotency_key: idem,
      shipping_address: "测试地址 上海市",
      buyer_name: "测",
    });
    expect(created.status).toBe(200);
    const createdText = toolText(created.msg);
    expect(createdText).toMatch(/ord_/);
    const createdJson = JSON.parse(createdText) as {
      order: { id: string; status: string };
      proof_upload: { url: string };
    };
    expect(createdJson.order.status).toBe("pending_payment");
    expect(createdJson.proof_upload.url).toContain(`https://example.com/shops/${SHOP}/orders/`);

    const orderId = createdJson.order.id;
    const got = await toolsCall("get_order", { order_id: orderId });
    expect(got.status).toBe(200);
    const gotJson = JSON.parse(toolText(got.msg)) as { order: { id: string; status: string } };
    expect(gotJson.order.id).toBe(orderId);
    expect(gotJson.order.status).toBe("pending_payment");

    const cancelled = await toolsCall("cancel_order", {
      order_id: orderId,
      reason: "test cancel",
    });
    expect(cancelled.status).toBe(200);
    const cancelledJson = JSON.parse(toolText(cancelled.msg)) as {
      order: { status: string };
    };
    expect(cancelledJson.order.status).toBe("cancelled");
  });

  it("submit_payment_proof transitions via status machine", async () => {
    const idem = `idem-mcp-proof-${Date.now()}`;
    const created = await toolsCall("create_order", {
      items: [{ product_id: "bb-yirg-250", quantity: 1 }],
      idempotency_key: idem,
      shipping_address: "测试地址",
    });
    const orderId = (JSON.parse(toolText(created.msg)) as { order: { id: string } }).order.id;

    const proof = await toolsCall("submit_payment_proof", {
      order_id: orderId,
      payment_method: "wechat",
      transaction_id: "wx_test_123",
      amount_cny: 80,
    });
    expect(proof.status).toBe(200);
    const proofJson = JSON.parse(toolText(proof.msg)) as {
      order: {
        status: string;
        timeline: { event: string; from_status: string | null; to_status: string | null }[];
      };
    };
    expect(proofJson.order.status).toBe("payment_submitted");
    expect(
      proofJson.order.timeline.some(
        (e) =>
          e.event === "payment_proof_submitted" &&
          e.from_status === "pending_payment" &&
          e.to_status === "payment_submitted",
      ),
    ).toBe(true);
  });
});
