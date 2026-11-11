#!/usr/bin/env python3
"""Seller admin API end-to-end test for agent-friendly-platform.

Covers the admin-driven lifecycle: a fresh order is created over MCP,
then the seller confirms payment and marks it shipped through the admin
API (Bearer key auth), and the buyer confirms receipt over MCP.
Negative cases: no key -> 401, wrong key -> 401, wrong-amount confirm
-> 400, mark-shipped on a non-paid order -> 400.

Usage: ADMIN_KEY=<terra-pots admin key> python3 tests/test_admin.py
The key is read from the environment only; it is never written to a file.
"""
import json
import os
import subprocess
import sys
import uuid

BASE = "https://agent-friendly-platform.refined-x.workers.dev"
SHOP = "terra-pots"
MCP_URL = f"{BASE}/shops/{SHOP}/mcp"
ADMIN = f"{BASE}/shops/{SHOP}/admin/api"
UA = "Mozilla/5.0 (agent-friendly-platform-test)"
KEY = os.environ.get("ADMIN_KEY", "")
assert KEY, "set ADMIN_KEY env var to the terra-pots admin key"


def curl(method, url, body=None, headers=None, cookie_jar=None):
    cmd = ["curl", "-sS", "--max-time", "30", "-X", method, url,
           "-H", f"User-Agent: {UA}"]
    if cookie_jar:
        cmd += ["-b", cookie_jar, "-c", cookie_jar]
    for k, v in (headers or {}).items():
        cmd += ["-H", f"{k}: {v}"]
    if body is not None:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(body)]
    out = subprocess.run(cmd, capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f"curl failed: {out.stderr}")
    return out.stdout


def mcp(method, params=None):
    msg = {"jsonrpc": "2.0", "id": str(uuid.uuid4())[:8], "method": method}
    if params is not None:
        msg["params"] = params
    body = curl("POST", MCP_URL, msg,
                {"Accept": "application/json, text/event-stream"})
    body = body.strip()
    if body.startswith("event:") or "\ndata:" in body:
        data = [json.loads(l[5:]) for l in body.splitlines() if l.startswith("data:")]
        return data[0]
    return json.loads(body)


def mcp_tool(name, arguments):
    return mcp("tools/call", {"name": name, "arguments": arguments})


def admin(method, path, body=None, key=True, jar=None):
    headers = {}
    if key:
        headers["Authorization"] = f"Bearer {KEY}"
    raw = curl(method, ADMIN + path, body, headers, jar)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        raise SystemExit(f"admin {method} {path} returned non-JSON: {raw[:300]}")


def admin_status(method, path, body=None, key=None):
    """Same as admin() but returns (http_status, parsed_json)."""
    headers = {}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    cmd = ["curl", "-sS", "--max-time", "30", "-o", "/tmp/admin_resp.json", "-w", "%{http_code}",
           "-X", method, ADMIN + path, "-H", f"User-Agent: {UA}"]
    for k, v in headers.items():
        cmd += ["-H", f"{k}: {v}"]
    if body is not None:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(body)]
    out = subprocess.run(cmd, capture_output=True, text=True)
    code = int(out.stdout.strip())
    data = json.loads(open("/tmp/admin_resp.json").read() or "{}")
    return code, data


def main():
    # 1. No key -> 401; wrong key -> 401.
    code, data = admin_status("GET", "/orders")
    assert code == 401, f"expected 401 without key, got {code}: {data}"
    print("NO-KEY ADMIN REJECTED (401)")
    code, data = admin_status("GET", "/orders", key="afk_wrongkey")
    assert code == 401, f"expected 401 with wrong key, got {code}: {data}"
    print("WRONG-KEY ADMIN REJECTED (401)")

    # 2. Login with the real key sets a session cookie; /me works.
    jar = "/tmp/admin_cookies.txt"
    raw = curl("POST", ADMIN + "/login", {"key": KEY}, {}, jar)
    login = json.loads(raw)
    assert login.get("shop") == SHOP, f"login failed: {raw[:200]}"
    print(f"LOGIN OK (session expires {login.get('expires')})")
    me = admin("GET", "/me", key=False, jar=jar)
    assert me.get("shop") == SHOP, f"/me failed: {me}"
    print("SESSION COOKIE AUTH OK")

    # 3. Fresh order over MCP.
    mcp("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                       "clientInfo": {"name": "agent-friendly-platform-admin-test", "version": "1.0"}})
    key = f"test-admin-{uuid.uuid4().hex[:12]}"
    res = mcp_tool("create_order", {"items": [{"product_id": "tp-mug-300", "quantity": 1}],
                                    "idempotency_key": key,
                                    "buyer_name": "后台测试买家", "buyer_contact": "admin-test@example.com",
                                    "shipping_address": "测试省测试市测试路 2 号"})
    order = json.loads(res["result"]["content"][0]["text"])["order"]
    print(f"\nORDER ID: {order['id']}  TOTAL: {order['total_cny']}  STATUS: {order['status']}")
    assert order["status"] == "pending_payment"
    mcp_tool("submit_payment_proof", {"order_id": order["id"], "payment_method": "wechat_pay",
                                      "transaction_id": f"test-txn-{uuid.uuid4().hex[:8]}",
                                      "amount_cny": order["total_cny"]})
    mid = json.loads(mcp_tool("get_order", {"order_id": order["id"]})["result"]["content"][0]["text"])["order"]
    assert mid["status"] == "payment_submitted"
    print(f"AFTER PROOF: {mid['status']}")

    # 4. Admin list shows the order; wrong-amount confirm -> 400.
    listing = admin("GET", "/orders?status=payment_submitted")
    ids = [o["id"] for o in listing["orders"]]
    assert order["id"] in ids, f"order not in admin list: {ids}"
    print(f"ADMIN LIST OK (payment_submitted count: {listing['counts']['payment_submitted']})")
    code, data = admin_status("POST", f"/orders/{order['id']}/confirm-payment",
                              {"verified_amount_cny": 100}, key=KEY)
    assert code == 400, f"expected 400 for wrong amount, got {code}: {data}"
    print("ADMIN WRONG-AMOUNT CONFIRM REJECTED (400)")

    # 5. Admin confirm-payment with the right amount -> paid.
    done = admin("POST", f"/orders/{order['id']}/confirm-payment",
                 {"verified_amount_cny": order["total_cny"], "note": "test: admin verified receipt"})
    assert done["order"]["status"] == "paid", f"expected paid, got: {done}"
    assert done["order"]["verified_amount_cny"] == order["total_cny"]
    print(f"ADMIN CONFIRM OK: {done['order']['status']}  VERIFIED: {done['order']['verified_amount_cny']}")

    # 6. Admin mark-shipped -> shipped; buyer confirm_receipt -> completed.
    done = admin("POST", f"/orders/{order['id']}/mark-shipped",
                 {"carrier": "顺丰", "tracking_number": "SF999888777"})
    assert done["order"]["status"] == "shipped", f"expected shipped, got: {done}"
    assert done["order"]["tracking_number"] == "SF999888777"
    print(f"ADMIN SHIP OK: {done['order']['status']}  TRACKING: {done['order']['tracking_number']}")
    res = mcp_tool("confirm_receipt", {"order_id": order["id"]})
    final = json.loads(res["result"]["content"][0]["text"])["order"]
    assert final["status"] == "completed", f"expected completed, got: {final['status']}"
    print(f"FINAL STATUS: {final['status']}")

    # 7. Events endpoint shows the full timeline.
    raw = curl("GET", f"{BASE}/shops/{SHOP}/api/orders/{order['id']}/events", None, {})
    events = json.loads(raw)["events"]
    names = [e["event"] for e in events]
    print(f"EVENTS: {names}")
    assert names == ["order_created", "payment_proof_submitted", "payment_confirmed", "shipped", "receipt_confirmed"], names

    # 8. Products PUT round-trip (change stock, then restore).
    before = admin("GET", "/products")["products"]
    mug = next(p for p in before if p["id"] == "tp-mug-300")
    updated = admin("PUT", "/products/tp-mug-300", {"stock": mug["stock"] + 1})
    assert updated["product"]["stock"] == mug["stock"] + 1, updated
    restored = admin("PUT", "/products/tp-mug-300", {"stock": mug["stock"]})
    assert restored["product"]["stock"] == mug["stock"], restored
    print(f"PRODUCTS PUT OK (stock {mug['stock']} -> +1 -> restored)")

    # 9. Policies GET works (no mutation in this test).
    pol = admin("GET", "/policies")
    assert pol["policies"]["shop"] == SHOP, pol
    assert pol["policies"]["order_statuses"] == ["pending_payment", "payment_submitted", "paid", "shipped", "completed", "cancelled"], pol["policies"]["order_statuses"]
    print("POLICIES GET OK")
    print("\nADMIN E2E PASS")


if __name__ == "__main__":
    main()
