#!/usr/bin/env python3
"""Update D1 shop facts from src/data without touching orders.

seed.py cannot be re-run safely (it replays ALTER TABLE migrations),
so this script updates only the rows that come from the shop files:
shop_policies.order_statuses and shop_payment.flow_json (+ summary).
Run after editing src/data/shops/*/policies.json or api/payment.json.

Usage: python3 scripts/update_shop_facts.py <account-id> <database-id>
"""
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
from dynamic_credentials import add_surrogate_to_request, read_json_response

BASE = "https://api.cloudflare.com"
CRED = "custom.cloudflare"
HOSTS = ["api.cloudflare.com"]
ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "src" / "data"
SHOPS = ["bean-bloom", "paper-lantern", "terra-pots"]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise RuntimeError("redirect refused")


def run_one(account, db, sql, params):
    url = f"{BASE}/client/v4/accounts/{account}/d1/database/{db}/query"
    body = json.dumps({"sql": sql, "params": params}).encode()
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
        raise SystemExit(f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:500]}")


def main():
    account, db = sys.argv[1], sys.argv[2]
    for slug in SHOPS:
        pol = json.loads((DATA / f"shops/{slug}/policies.json").read_text(encoding="utf-8"))
        pay = json.loads((DATA / f"shops/{slug}/api/payment.json").read_text(encoding="utf-8"))["payment"]
        run_one(account, db,
                "UPDATE shop_policies SET order_statuses = ? WHERE shop = ?",
                [json.dumps(pol["order_statuses"]), slug])
        run_one(account, db,
                "UPDATE shop_payment SET summary = ?, flow_json = ? WHERE shop = ?",
                [pay["summary"], json.dumps(pay["flow"], ensure_ascii=False), slug])
        print(f"{slug}: order_statuses + payment flow updated in D1")


if __name__ == "__main__":
    main()
