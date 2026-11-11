#!/usr/bin/env python3
"""Generate one admin key per shop and store ONLY its SHA-256 hash in D1.

The plaintext keys are printed to stdout once — give them to Hall, who
hands each key to that shop's owner. They are never written to any file
in this repo, and this script never logs them anywhere else.
Re-running rotates the keys (old keys stop working).

Usage: python3 scripts/gen_admin_keys.py <account-id> <database-id>
"""
import hashlib
import json
import secrets
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
from dynamic_credentials import add_surrogate_to_request, read_json_response

BASE = "https://api.cloudflare.com"
CRED = "custom.cloudflare"
HOSTS = ["api.cloudflare.com"]
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
    keys = {}
    for shop in SHOPS:
        key = "afk_" + secrets.token_hex(24)
        key_hash = hashlib.sha256(key.encode()).hexdigest()
        run_one(account, db,
                "INSERT INTO shop_admin_keys (shop, key_hash, created_at) VALUES (?, ?, datetime('now')) "
                "ON CONFLICT(shop) DO UPDATE SET key_hash = excluded.key_hash, created_at = excluded.created_at, last_used_at = NULL",
                [shop, key_hash])
        keys[shop] = key
    print("Admin keys generated (plaintext — give these to Hall ONCE, never commit them):")
    for shop, key in keys.items():
        print(f"  {shop}: {key}")


if __name__ == "__main__":
    main()
