#!/usr/bin/env python3
"""End-to-end MCP test client for agent-friendly-platform.

Usage: python3 tests/test_client.py [shop]
Default shop: terra-pots. Prints every JSON-RPC request/response.
Uses curl as transport (urllib truncates large bodies through the egress
proxy; see the refined-x client for the same reason).
"""
import json
import subprocess
import sys
import uuid

BASE = "https://agent-friendly-platform.refined-x.workers.dev"
SHOP = sys.argv[1] if len(sys.argv) > 1 else "terra-pots"
URL = f"{BASE}/shops/{SHOP}/mcp"
UA = "Mozilla/5.0 (agent-friendly-platform-test)"


def call(msg):
    payload = json.dumps(msg)
    out = subprocess.run(
        ["curl", "-sS", "--max-time", "30", "-X", "POST", URL,
         "-H", "Content-Type: application/json",
         "-H", "Accept: application/json, text/event-stream",
         "-H", f"User-Agent: {UA}",
         "-d", payload],
        capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f"curl failed: {out.stderr}")
    body = out.stdout.strip()
    if body.startswith("event:") or "\ndata:" in body:
        data = [json.loads(l[5:]) for l in body.splitlines() if l.startswith("data:")]
        return data[0] if len(data) == 1 else data
    return json.loads(body)


def rpc(method, params=None, mid=None):
    msg = {"jsonrpc": "2.0", "id": mid if mid is not None else str(uuid.uuid4())[:8],
           "method": method}
    if params is not None:
        msg["params"] = params
    print(f"\n>>> {method} {json.dumps(params or {}, ensure_ascii=False)}")
    res = call(msg)
    print(json.dumps(res, ensure_ascii=False, indent=2)[:3000])
    return res


def tool(name, arguments):
    return rpc("tools/call", {"name": name, "arguments": arguments})


def main():
    rpc("initialize", {"protocolVersion": "2025-06-18",
                       "capabilities": {}, "clientInfo": {"name": "agent-friendly-platform-test", "version": "1.0"}})
    subprocess.run(["curl", "-sS", "--max-time", "30", "-X", "POST", URL,
                    "-H", "Content-Type: application/json",
                    "-H", "Accept: application/json, text/event-stream",
                    "-H", f"User-Agent: {UA}",
                    "-d", json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"})],
                   capture_output=True)
    rpc("tools/list")
    rpc("ping")
    tool("list_products", {})
    tool("get_product", {"product_id": "tp-mug-300"})
    tool("recommend_products", {"use": "日常喝水、喝茶", "budget_cny": 300})
    tool("calculate_total", {"items": [{"product_id": "tp-mug-300", "quantity": 1}]})
    key = f"test-{uuid.uuid4().hex[:12]}"
    res = tool("create_order", {"items": [{"product_id": "tp-mug-300", "quantity": 1}],
                                "idempotency_key": key})
    order = json.loads(res["result"]["content"][0]["text"])["order"]
    print(f"\nORDER ID: {order['id']}  TOTAL: {order['total_cny']}  STATUS: {order['status']}")
    tool("submit_payment_proof", {"order_id": order["id"], "payment_method": "wechat_pay",
                                  "transaction_id": f"test-txn-{uuid.uuid4().hex[:8]}",
                                  "amount_cny": order["total_cny"]})
    res = tool("get_order", {"order_id": order["id"]})
    final = json.loads(res["result"]["content"][0]["text"])["order"]
    print(f"\nFINAL STATUS: {final['status']}  PROOFS: {len(final['proofs'])}")
    assert final["status"] == "paid", "expected paid"
    print("\nE2E PASS")


if __name__ == "__main__":
    main()
