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
    res = rpc("tools/list")
    names = [t["name"] for t in res["result"]["tools"]]
    print(f"\nTOOLS ({len(names)}): {names}")
    assert len(names) == 13 and "get_payment_proof_upload_link" in names, f"expected 13 tools incl. get_payment_proof_upload_link, got: {names}"
    rpc("ping")
    tool("list_products", {})
    tool("get_product", {"product_id": "tp-mug-300"})
    tool("recommend_products", {"use": "日常喝水、喝茶", "budget_cny": 300})
    tool("calculate_total", {"items": [{"product_id": "tp-mug-300", "quantity": 1}]})
    key = f"test-{uuid.uuid4().hex[:12]}"
    res = tool("create_order", {"items": [{"product_id": "tp-mug-300", "quantity": 1}],
                                "idempotency_key": key,
                                "buyer_name": "测试买家", "buyer_contact": "test@example.com",
                                "shipping_address": "测试省测试市测试路 1 号"})
    order = json.loads(res["result"]["content"][0]["text"])["order"]
    print(f"\nORDER ID: {order['id']}  TOTAL: {order['total_cny']}  STATUS: {order['status']}")
    assert order["status"] == "pending_payment", "expected pending_payment"
    assert order["buyer_name"] == "测试买家" and order["shipping_address"].endswith("1 号"), "buyer info not stored"
    assert order["timeline"] and order["timeline"][0]["event"] == "order_created", "expected order_created event"
    # confirm_receipt on a non-shipped order must fail.
    res = tool("confirm_receipt", {"order_id": order["id"]})
    assert res.get("result", {}).get("isError") is True, f"expected confirm_receipt on pending_payment to fail, got: {res}"
    print("\nCONFIRM_RECEIPT ON PENDING ORDER REJECTED")
    # Submitting a proof must NOT mark the order paid — only payment_submitted.
    res = tool("submit_payment_proof", {"order_id": order["id"], "payment_method": "wechat_pay",
                                        "transaction_id": f"test-txn-{uuid.uuid4().hex[:8]}",
                                        "amount_cny": order["total_cny"]})
    submitted = json.loads(res["result"]["content"][0]["text"])["order"]
    print(f"\nAFTER PROOF: {submitted['status']}  PROOFS: {len(submitted['proofs'])}")
    assert submitted["status"] == "payment_submitted", "expected payment_submitted"
    # Wrong verified amount must fail and leave the order payment_submitted.
    res = tool("confirm_payment", {"order_id": order["id"], "verified_amount_cny": 100,
                                   "note": "test: wrong amount"})
    # The MCP SDK reports tool errors as result.isError, not a top-level
    # JSON-RPC "error" field.
    assert res.get("result", {}).get("isError") is True, f"expected confirm_payment with 100 to fail, got: {res}"
    print(f"\nWRONG-AMOUNT CONFIRM REJECTED: {res['result']['content'][0]['text']}")
    mid = json.loads(tool("get_order", {"order_id": order["id"]})["result"]["content"][0]["text"])["order"]
    assert mid["status"] == "payment_submitted", "expected still payment_submitted after failed confirm"
    # Correct amount confirms and marks paid.
    res = tool("confirm_payment", {"order_id": order["id"], "verified_amount_cny": order["total_cny"],
                                   "note": "test: seller verified receipt"})
    confirmed = json.loads(res["result"]["content"][0]["text"])["order"]
    print(f"\nAFTER CONFIRM: {confirmed['status']}  VERIFIED: {confirmed.get('verified_amount_cny')} at {confirmed.get('verified_at')}")
    assert confirmed["status"] == "paid", "expected paid"
    assert confirmed.get("verified_amount_cny") == order["total_cny"], "expected verified amount = total"
    res = tool("get_order", {"order_id": order["id"]})
    final = json.loads(res["result"]["content"][0]["text"])["order"]
    print(f"\nFINAL STATUS: {final['status']}  PROOFS: {len(final['proofs'])}")
    assert final["status"] == "paid", "expected paid"
    # Cancelling a paid order must fail.
    res = tool("cancel_order", {"order_id": order["id"], "reason": "test: cancel paid order"})
    assert res.get("result", {}).get("isError") is True, f"expected cancel on paid to fail, got: {res}"
    print("\nCANCEL ON PAID ORDER REJECTED")
    # Seller marks the order shipped (MCP tool; admin UI shares this logic).
    res = tool("mark_shipped", {"order_id": order["id"], "carrier": "顺丰", "tracking_number": "SF1234567890"})
    shipped = json.loads(res["result"]["content"][0]["text"])["order"]
    print(f"\nAFTER SHIP: {shipped['status']}  CARRIER: {shipped.get('carrier')}  TRACKING: {shipped.get('tracking_number')}")
    assert shipped["status"] == "shipped", "expected shipped"
    assert shipped.get("tracking_number") == "SF1234567890", "expected tracking number stored"
    # Buyer confirms receipt -> completed.
    res = tool("confirm_receipt", {"order_id": order["id"]})
    done = json.loads(res["result"]["content"][0]["text"])["order"]
    print(f"\nAFTER RECEIPT: {done['status']}  COMPLETED_AT: {done.get('completed_at')}")
    assert done["status"] == "completed", "expected completed"
    res = tool("get_order", {"order_id": order["id"]})
    final = json.loads(res["result"]["content"][0]["text"])["order"]
    events = [e["event"] for e in final["timeline"]]
    print(f"\nTIMELINE: {events}")
    assert events == ["order_created", "payment_proof_submitted", "payment_confirmed", "shipped", "receipt_confirmed"], f"unexpected timeline: {events}"
    assert final["status"] == "completed", "expected completed"
    # Updating buyer info on a completed order must fail (frozen once shipped).
    res = tool("update_buyer_info", {"order_id": order["id"], "buyer_name": "改名"})
    assert res.get("result", {}).get("isError") is True, f"expected update_buyer_info on completed to fail, got: {res}"
    print("\nUPDATE_BUYER_INFO ON COMPLETED ORDER REJECTED")
    # A second order: created WITHOUT a shipping address must fail
    # (address is required at the tool level since v1.5.0).
    res = tool("create_order", {"items": [{"product_id": "tp-plate-20", "quantity": 1}],
                                "idempotency_key": f"test-{uuid.uuid4().hex[:12]}"})
    assert res.get("result", {}).get("isError") is True, f"expected create_order without shipping_address to fail, got: {res}"
    print("\nCREATE_ORDER WITHOUT SHIPPING ADDRESS REJECTED")
    # Created with ONLY the shipping address (name/contact stay optional).
    key2 = f"test-{uuid.uuid4().hex[:12]}"
    res = tool("create_order", {"items": [{"product_id": "tp-plate-20", "quantity": 1}],
                                "idempotency_key": key2,
                                "shipping_address": "测试省测试市测试路 1 号"})
    created2 = json.loads(res["result"]["content"][0]["text"])
    order2 = created2["order"]
    assert order2["buyer_name"] is None and order2["shipping_address"].endswith("1 号"), "expected address-only order"
    # create_order returns a proof-upload link with the order (v1.6.0).
    assert "/upload-proof?token=" in created2.get("proof_upload", {}).get("url", ""), f"expected proof_upload.url, got: {created2.get('proof_upload')}"
    print(f"\nPROOF UPLOAD LINK FROM CREATE_ORDER: {created2['proof_upload']['url'][:90]}...")
    # No fields at all must fail.
    res = tool("update_buyer_info", {"order_id": order2["id"]})
    assert res.get("result", {}).get("isError") is True, f"expected update_buyer_info with no fields to fail, got: {res}"
    print("\nUPDATE_BUYER_INFO WITH NO FIELDS REJECTED")
    # Partial update: fill name/contact only; the address stays.
    res = tool("update_buyer_info", {"order_id": order2["id"],
                                     "buyer_name": "测试买家", "buyer_contact": "test@example.com"})
    updated = json.loads(res["result"]["content"][0]["text"])["order"]
    print(f"\nAFTER UPDATE_BUYER_INFO: {updated['buyer_name']} / {updated['buyer_contact']} / {updated['shipping_address']}")
    assert updated["buyer_name"] == "测试买家" and updated["buyer_contact"] == "test@example.com" and updated["shipping_address"].endswith("1 号"), "buyer info not updated"
    assert updated["status"] == "pending_payment", "update must not change status"
    assert [e["event"] for e in updated["timeline"]] == ["order_created", "buyer_info_updated"], f"unexpected timeline: {[e['event'] for e in updated['timeline']]}"
    print("BUYER_INFO_UPDATED EVENT RECORDED")
    # v1.6.0: one-time proof upload link. The buyer uploads a payment
    # screenshot directly; the agent never reads the image.
    res = tool("get_payment_proof_upload_link", {"order_id": order2["id"]})
    link = json.loads(res["result"]["content"][0]["text"])
    assert "/upload-proof?token=" in link["upload_url"], f"expected upload_url, got: {link}"
    assert link["status"] == "pending_payment", f"expected pending_payment, got: {link['status']}"
    print(f"\nUPLOAD LINK: {link['upload_url'][:90]}... expires {link['expires_at']}")
    # A 1x1 PNG as the payment screenshot, uploaded via multipart POST.
    import base64
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
    with open("/tmp/test-proof.png", "wb") as f:
        f.write(png)
    out = subprocess.run(
        ["curl", "-sS", "--max-time", "30", "-X", "POST", link["upload_url"],
         "-H", f"User-Agent: {UA}",
         "-F", "payment_method=wechat_pay",
         "-F", f"transaction_id=test-txn-{uuid.uuid4().hex[:8]}",
         "-F", "file=@/tmp/test-proof.png;type=image/png"],
        capture_output=True, text=True)
    assert out.returncode == 0, f"upload curl failed: {out.stderr}"
    assert "付款截图已提交" in out.stdout, f"expected upload success page, got: {out.stdout[:500]}"
    print("\nUPLOAD SUCCESS PAGE RETURNED")
    after = json.loads(tool("get_order", {"order_id": order2["id"]})["result"]["content"][0]["text"])["order"]
    assert after["status"] == "payment_submitted", f"expected payment_submitted after image upload, got: {after['status']}"
    assert len(after["proofs"]) == 1 and after["proofs"][0]["proof_type"] == "image", f"expected one image proof, got: {after['proofs']}"
    assert after["proofs"][0]["r2_key"].startswith("proofs/terra-pots/"), f"expected R2 key, got: {after['proofs'][0]}"
    assert [e["event"] for e in after["timeline"]] == ["order_created", "buyer_info_updated", "payment_proof_submitted"], f"unexpected timeline: {[e['event'] for e in after['timeline']]}"
    print(f"IMAGE PROOF RECORDED: {after['proofs'][0]['r2_key']}  STATUS: {after['status']}")
    # The same link is single-use: a second upload must be refused.
    out = subprocess.run(
        ["curl", "-sS", "--max-time", "30", "-X", "POST", link["upload_url"],
         "-H", f"User-Agent: {UA}",
         "-F", "payment_method=wechat_pay",
         "-F", "file=@/tmp/test-proof.png;type=image/png"],
        capture_output=True, text=True)
    assert "链接无效" in out.stdout, f"expected reused link to be refused, got: {out.stdout[:300]}"
    print("REUSED UPLOAD LINK REFUSED")
    # A forged token must be refused too.
    bad = link["upload_url"].rsplit("token=", 1)[0] + "token=" + "0" * 64
    out = subprocess.run(
        ["curl", "-sS", "--max-time", "30", bad, "-H", f"User-Agent: {UA}"],
        capture_output=True, text=True)
    assert "链接无效" in out.stdout, f"expected forged token to be refused, got: {out.stdout[:300]}"
    print("FORGED UPLOAD TOKEN REFUSED")
    # get_payment_proof_upload_link on a cancelled order must fail.
    res = tool("cancel_order", {"order_id": order2["id"], "reason": "test: buyer changed mind"})
    cancelled = json.loads(res["result"]["content"][0]["text"])["order"]
    print(f"\nCANCELLED ORDER: {cancelled['id']}  STATUS: {cancelled['status']}")
    assert cancelled["status"] == "cancelled", "expected cancelled"
    res = tool("get_payment_proof_upload_link", {"order_id": order2["id"]})
    assert res.get("result", {}).get("isError") is True, f"expected upload link on cancelled order to fail, got: {res}"
    print("UPLOAD LINK ON CANCELLED ORDER REJECTED")
    print("\nE2E PASS")


if __name__ == "__main__":
    main()
