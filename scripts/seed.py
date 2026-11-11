#!/usr/bin/env python3
"""Seed the agent-friendly-orders D1 database from src/data.

Reads the imported shop files (verbatim copies of the GitHub Pages JSON,
host already rewritten) plus the one migrated Durable Object test order
(/tmp/do_order.json, fetched live from the old agent-friendly-mcp Worker).
Posts statements in batches to the D1 /batch endpoint using the registered
custom.cloudflare credential via the same surrogate exchange as cf.py.
Nothing here contains the API token.

Usage:
  python3 scripts/seed.py <account-id> <database-id> [--migrate-order /tmp/do_order.json]
"""
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE = "https://api.cloudflare.com"
CRED = "custom.cloudflare"
HOSTS = ["api.cloudflare.com"]
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "src" / "data"
SHOPS = ["bean-bloom", "paper-lantern", "terra-pots"]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise RuntimeError("redirect refused")


def run_one(account, db, stmt):
    """One statement via D1 /query (the /batch endpoint 404s on this account,
    so statements are executed one at a time)."""
    # Muse surrogate credentials are only needed for the live API path.
    sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
    from dynamic_credentials import add_surrogate_to_request, read_json_response
    url = f"{BASE}/client/v4/accounts/{account}/d1/database/{db}/query"
    body = json.dumps({"sql": stmt["sql"], "params": stmt["params"]}).encode()
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={"User-Agent": "muse-custom-connector/1",
                 "Content-Type": "application/json",
                 "Accept": "application/json"})
    add_surrogate_to_request(req, CRED, allowed_hosts=HOSTS)
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=60) as resp:
            return read_json_response(resp)
    except urllib.error.HTTPError as e:
        raise SystemExit(f"HTTP {e.code} for {stmt['sql'][:80]}: "
                         f"{e.read().decode('utf-8', 'replace')[:800]}")


def load(rel):
    return json.loads((DATA / rel).read_text(encoding="utf-8"))


def build_statements(migrate_order_path):
    stmts = []
    shops_json = load("shops.json")
    for entry in shops_json["shops"]:
        slug = entry["slug"]
        agent = load(f"shops/{slug}/agent.json")
        pres = load(f"shops/{slug}/api/presentation.json")
        loc = pres.get("location") or {}
        stmts.append({"sql": "INSERT OR REPLACE INTO shops (slug, name, name_zh, category, description, city, latitude, longitude, address, pickup, currency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                      "params": [slug, entry["name"], entry.get("name_zh"), entry.get("category"),
                                 agent.get("description"), loc.get("city"), loc.get("latitude"),
                                 loc.get("longitude"), loc.get("address"), loc.get("pickup"), "CNY"]})
        for p in load(f"shops/{slug}/api/products.json")["products"]:
            stmts.append({"sql": "INSERT OR REPLACE INTO products (id, shop, name, name_zh, price, currency, stock, description, url, image_url, image_credit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                          "params": [p["id"], slug, p["name"], p.get("name_zh"), p["price"],
                                     p.get("currency", "CNY"), p["stock"], p.get("description"),
                                     p.get("url"), p.get("image_url"), p.get("image_credit")]})
        pol = load(f"shops/{slug}/policies.json")
        stmts.append({"sql": "INSERT OR REPLACE INTO shop_policies (shop, shipping_flat_cny, free_over_cny, lead_time, returns_window_days, returns_condition, return_shipping, privacy, order_statuses) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                      "params": [slug, pol["shipping"]["flat_fee_cny"], pol["shipping"]["free_over_cny"],
                                 pol["shipping"]["lead_time"], pol["returns"]["window_days"],
                                 pol["returns"].get("condition"), pol["returns"].get("return_shipping"),
                                 pol.get("privacy"), json.dumps(pol.get("order_statuses", []))]})
        pay = load(f"shops/{slug}/api/payment.json")["payment"]
        for m in pay["methods"]:
            stmts.append({"sql": "INSERT OR REPLACE INTO payment_methods (shop, method_id, label, instructions) VALUES (?, ?, ?, ?)",
                          "params": [slug, m["id"], m["label"], m["instructions"]]})
        stmts.append({"sql": "INSERT OR REPLACE INTO shop_payment (shop, summary, flow_json, never_in_chat_json) VALUES (?, ?, ?, ?)",
                      "params": [slug, pay["summary"], json.dumps(pay["flow"]),
                                 json.dumps(pay.get("never_in_chat", []))]})
        recs = load(f"shops/{slug}/api/recommendations.json")
        for i, r in enumerate(recs["recommendations"]):
            stmts.append({"sql": "INSERT OR REPLACE INTO recommendations (shop, product_id, best_for, why, alternative_if_out, rank) VALUES (?, ?, ?, ?, ?, ?)",
                          "params": [slug, r["product_id"], r.get("best_for"), r.get("why"),
                                     r.get("alternative_if_out"), i]})
        for b in recs.get("bundles", []):
            stmts.append({"sql": "INSERT OR REPLACE INTO shop_bundles (shop, name, items_json, total_cny, note) VALUES (?, ?, ?, ?, ?)",
                          "params": [slug, b["name"], json.dumps(b["items"]), b["total_cny"], b.get("note")]})
    if migrate_order_path:
        o = json.loads(json.loads(Path(migrate_order_path).read_text())["result"]["content"][0]["text"])["order"]
        stmts.append({"sql": "INSERT OR REPLACE INTO orders (id, shop, items_json, subtotal_cny, shipping_cny, total_cny, status, idempotency_key, buyer_note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                      "params": [o["id"], o["shop"], json.dumps(o["items"]), o["subtotal_cny"],
                                 o["shipping_cny"], o["total_cny"], o["status"], o["idempotency_key"],
                                 o.get("buyer_note"), o["created_at"], o["updated_at"]]})
        for pr in o.get("proofs", []):
            stmts.append({"sql": "INSERT OR REPLACE INTO payment_proofs (id, order_id, payment_method, transaction_id, amount_cny, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                          "params": [pr["id"], pr["order_id"], pr["payment_method"],
                                     pr["transaction_id"], pr["amount_cny"], pr["created_at"]]})
    return stmts


if __name__ == "__main__":
    # Phase 2.4: --dump prints data statements only (no migrations / no D1)
    # so scripts/seed.ts --dump can be compared line-for-line.
    if len(sys.argv) >= 2 and sys.argv[1] == "--dump":
        order_path = sys.argv[3] if len(sys.argv) > 3 and sys.argv[2] == "--migrate-order" else None
        for stmt in build_statements(order_path):
            # separators match JSON.stringify (no spaces) for line diffs.
            print(json.dumps(stmt, ensure_ascii=False, separators=(",", ":")))
        raise SystemExit(0)
    account, db = sys.argv[1], sys.argv[2]
    order_path = sys.argv[4] if len(sys.argv) > 4 and sys.argv[3] == "--migrate-order" else None
    # Prefer drizzle/ (Phase 2.3); fall back to migrations/*.sql for old checkouts.
    mig_dir = ROOT / "drizzle"
    mig_files = sorted(mig_dir.glob("*.sql")) if mig_dir.is_dir() else []
    if not mig_files:
        mig_files = sorted((ROOT / "migrations").glob("*.sql"))
    schema_stmts = []
    for mig in mig_files:
        schema = mig.read_text(encoding="utf-8")
        schema = "\n".join(l for l in schema.splitlines()
                           if not l.strip().startswith("--")
                           and "statement-breakpoint" not in l)
        schema_stmts += [{"sql": s.strip(), "params": []}
                         for s in schema.split(";") if s.strip()]
        print(f"migration {mig.name}: {len(schema_stmts)} statements so far")
    stmts = schema_stmts + build_statements(order_path)
    print(f"{len(stmts)} statements to run")
    for i, stmt in enumerate(stmts):
        res = run_one(account, db, stmt)
        if not res.get("success"):
            raise SystemExit(f"statement {i} failed: {json.dumps(res)[:800]}")
        if (i + 1) % 10 == 0:
            print(f"{i + 1}/{len(stmts)} ok")
    print("seed done")
