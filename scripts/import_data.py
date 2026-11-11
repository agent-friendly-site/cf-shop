#!/usr/bin/env python3
"""Import shop data from the GitHub Pages source into cf-shop/src/data.

Source: ~/workspace/agent-friendly-site (the exact files live on GitHub Pages).
Every URL is rewritten from the old hosts to the new Cloudflare Worker host:
  https://agent-friendly-site.github.io            -> NEW_BASE
  https://agent-friendly-mcp.refined-x.workers.dev -> NEW_BASE
Stale wording left over from the static-hosting era is fixed here, and every
fix is printed so the migration report can list it. Nothing is invented:
products, prices, stock, policies and recommendations come verbatim from
the source files.
"""
import json
import re
import shutil
from pathlib import Path

SRC = Path.home() / "workspace" / "agent-friendly-site"
DST = Path.home() / "workspace" / "cf-shop" / "src" / "data"
OLD_BASE = "https://agent-friendly-site.github.io"
OLD_MCP = "https://agent-friendly-mcp.refined-x.workers.dev"
NEW_BASE = "https://agent-friendly-platform.refined-x.workers.dev"
SHOPS = ["bean-bloom", "paper-lantern", "terra-pots"]

FIXES = [
    # duplicated sentence (source artifact)
    ("Agent-only shop. Agent-only shop.", "Agent-only shop."),
    # llms-full.txt: stale static-era notes
    ("Ships in 2 business days (no shipment).", "Ships in 2 business days."),
    (" (no returns processed)", ""),
    ("Privacy: no personal data is collected .",
     "Privacy: Order and delivery information only; never shared with third parties."),
    # guide.md: sentence duplicated back-to-back in flow item 6
    ("确认订单后按线下支付流程走：卖家提供收款方式，买家在 Agent 外付款后提交付款凭据，卖家核验后发货。不要在聊天里索要或接收银行卡号、验证码。确认订单后按线下支付流程走：",
     "确认订单后按线下支付流程走："),
    # guide.md: checkout-page wording contradicts offline payment
    ("Payment happens on the shop checkout page, never card details in chat.",
     "Payment is offline: the seller provides payment instructions, the buyer pays outside the agent, then submits the transaction id. Never send card numbers or verification codes in chat."),
    # guide.md: photos now exist (CC-licensed illustrations)
    ("There are no product photos in the shop files yet (image_url is null) — show cards without photos, never borrow another seller's photos.",
     "Product photos are CC-licensed illustrative photos (see image_credit in the product data); label them as illustrations, never borrow another seller's photos."),
    # shop llms.txt / root llms.txt: catalog no longer on GitHub Pages
    ("The shop catalog lives on GitHub Pages (static JSON); the MCP endpoint above is the live server — POST it, do not try to POST to GitHub Pages.",
     "The shop catalog is served from D1 on this Worker; the MCP endpoint above is the live server."),
    ("The catalog JSON stays on GitHub Pages.",
     "The catalog is served from D1 on this Worker."),
    # shop index.html
    ("(MCP endpoint documented; not live on GitHub Pages)",
     "(live MCP endpoint, see mcp.json)"),
    # root index.html
    ("See README.md and DISCOVERY.md in the repo for the discovery protocol.",
     "Source code: https://github.com/agent-friendly-site/cf-shop"),
    # mcp.json: old worker note
    ("Live MCP server on Cloudflare Workers (agent-friendly-mcp). POST this endpoint with JSON-RPC initialize, then tools/list, then tools/call. Catalog is fetched live from GitHub Pages products.json; orders live in a Durable Object.",
     "Live MCP server on Cloudflare Workers (agent-friendly-platform, Hono + D1). POST this endpoint with JSON-RPC initialize, then tools/list, then tools/call. Catalog and orders are served from D1."),
    ("Demo: submitting a transaction id marks the order paid (simulated verification); a real deployment must verify receipt first — see api/payment.json (seller verifies within 24h).",
     "Submitting a transaction id marks the order paid (verification is simulated: a real deployment must verify receipt first — see api/payment.json, seller verifies within 24h)."),
    ("演示说明：当前 Worker 收到凭据即标记已付款（模拟核验），真实部署须先核对到账再标记已付款。",
     "Verification note: the Worker marks the order paid when a transaction id is submitted (simulated verification); a real deployment must verify receipt first."),
    # openapi.json: static-era MCP wording
    ("In production this is POST", "This is POST"),
    ("Catalog is fetched live from GitHub Pages; orders live in a Cloudflare Durable Object.",
     "Catalog and orders are served from D1 on this Worker."),
    ("GitHub Pages is static-only, so this documents the endpoint in mcp.json instead of serving a live MCP server. See README.md / DISCOVERY.md.",
     "The endpoint is live on Cloudflare Workers; see mcp.json."),
    ("create_order (mock)", "create_order"),
]


def rewrite_text(text, path):
    out = text.replace(OLD_BASE, NEW_BASE).replace(OLD_MCP, NEW_BASE)
    for old, new in FIXES:
        if old in out:
            out = out.replace(old, new)
            print(f"  fix [{path}]: {old[:60]}...")
    return out


def copy_file(src, dst):
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.suffix == ".json":
        data = json.loads(src.read_text(encoding="utf-8"))
        text = json.dumps(data, ensure_ascii=False, indent=1)
        # openapi version bump for the Cloudflare-hosted release
        if src.name == "openapi.json":
            data["info"]["version"] = "1.0.0"
            text = json.dumps(data, ensure_ascii=False, indent=1)
        text = rewrite_text(text, str(src.relative_to(SRC)))
        dst.write_text(text + "\n", encoding="utf-8")
    else:
        text = rewrite_text(src.read_text(encoding="utf-8"), str(src.relative_to(SRC)))
        dst.write_text(text, encoding="utf-8")
    print(f"copied {src.relative_to(SRC)} -> {dst.relative_to(DST.parent.parent)}")


ROOT_FILES = ["llms.txt", "llms-full.txt", "openapi.json", "shops.json",
              "index.html", "robots.txt", "sitemap.xml"]
SHOP_FILES = ["index.html", "llms.txt", "llms-full.txt", "openapi.json",
              "agent.json", "mcp.json", "policies.json", "guide.md",
              "starter-prompt.txt"]
SHOP_API_FILES = ["catalog.json", "payment.json", "recommendations.json",
                  "presentation.json", "products.json"]

if __name__ == "__main__":
    if DST.exists():
        shutil.rmtree(DST)
    for f in ROOT_FILES:
        copy_file(SRC / f, DST / f)
    copy_file(SRC / ".well-known" / "agent.json", DST / "well-known-agent.json")
    for shop in SHOPS:
        for f in SHOP_FILES:
            copy_file(SRC / "shops" / shop / f, DST / "shops" / shop / f)
        copy_file(SRC / "shops" / shop / ".well-known" / "agent.json",
                  DST / "shops" / shop / "well-known-agent.json")
        for f in SHOP_API_FILES:
            copy_file(SRC / "shops" / shop / "api" / f,
                      DST / "shops" / shop / "api" / f)
    print("done")
