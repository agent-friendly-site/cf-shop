#!/usr/bin/env python3
"""Compare every agent-facing route between GitHub Pages and the new Worker.

Usage: python3 tests/compare_routes.py
Prints MATCH / DIFF / ERROR per route. JSON is compared semantically
(parsed, URLs host-normalized); text is compared line by line and the
first differing lines are shown. Diffs are expected only where the host
changed or where the migration intentionally changed content (see README.md).
Uses curl (urllib truncates bodies through the egress proxy).
"""
import difflib
import json
import subprocess
import sys

OLD = "https://agent-friendly-site.github.io"
NEW = "https://agent-friendly-platform.refined-x.workers.dev"
UA = "Mozilla/5.0 (agent-friendly-platform-test)"

SHOPS = ["bean-bloom", "paper-lantern", "terra-pots"]
ROOT_PATHS = ["", "/llms.txt", "/llms-full.txt", "/shops.json", "/openapi.json",
              "/.well-known/agent.json", "/robots.txt", "/sitemap.xml"]
SHOP_PATHS = ["", "/llms.txt", "/llms-full.txt", "/openapi.json", "/agent.json",
              "/.well-known/agent.json", "/api/products.json", "/api/catalog.json",
              "/policies.json", "/api/payment.json", "/api/presentation.json",
              "/api/recommendations.json", "/guide.md", "/starter-prompt.txt",
              "/mcp.json", "/index.html"]


def get(url):
    out = subprocess.run(["curl", "-sS", "-w", "\n%{http_code}", "--max-time", "30",
                          "-H", f"User-Agent: {UA}", url],
                         capture_output=True, text=True)
    if out.returncode != 0:
        return None, out.stderr.strip()
    body, _, code = out.stdout.rpartition("\n")
    return (body, int(code)), None


def norm_str(s):
    return (s.replace(OLD, NEW)
             .replace("agent-friendly-mcp.refined-x.workers.dev",
                      "agent-friendly-platform.refined-x.workers.dev"))


def norm_obj(o):
    if isinstance(o, str):
        return norm_str(o)
    if isinstance(o, list):
        return [norm_obj(x) for x in o]
    if isinstance(o, dict):
        return {k: norm_obj(v) for k, v in o.items()}
    return o


def compare(path, old_body, new_body):
    """Return (equal, detail). JSON compared semantically, text line-wise."""
    try:
        old_json, new_json = json.loads(old_body), json.loads(new_body)
        if norm_obj(old_json) == new_json:
            return True, ""
        old_s = json.dumps(norm_obj(old_json), indent=1, sort_keys=True, ensure_ascii=False).splitlines()
        new_s = json.dumps(new_json, indent=1, sort_keys=True, ensure_ascii=False).splitlines()
        diff = "\n".join(list(difflib.unified_diff(old_s, new_s, lineterm=""))[:24])
        return False, diff
    except (json.JSONDecodeError, ValueError):
        if norm_str(old_body) == new_body:
            return True, ""
        diff = "\n".join(list(difflib.unified_diff(
            norm_str(old_body).splitlines(), new_body.splitlines(), lineterm=""))[:24])
        return False, diff


def main():
    paths = [p if p else "/" for p in ROOT_PATHS]
    paths += [f"/shops/{s}{p}" if p else f"/shops/{s}/" for s in SHOPS for p in SHOP_PATHS]
    match = diff = error = 0
    for path in paths:
        old, err1 = get(OLD + path)
        new, err2 = get(NEW + path)
        if err1 or err2 or old is None or new is None:
            print(f"ERROR {path}: old={err1} new={err2}")
            error += 1
            continue
        (old_body, old_code), (new_body, new_code) = old, new
        if old_code != new_code:
            print(f"DIFF  {path}: status old={old_code} new={new_code}")
            diff += 1
            continue
        equal, detail = compare(path, old_body, new_body)
        if equal:
            print(f"MATCH {path}")
            match += 1
        else:
            print(f"DIFF  {path}:\n{detail}\n---")
            diff += 1
    print(f"\n{match} match, {diff} diff, {error} error, {len(paths)} total")
    return 0 if error == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
