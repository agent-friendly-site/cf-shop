#!/usr/bin/env npx tsx
/**
 * Generate one admin key per shop; store ONLY SHA-256 hash in D1.
 *
 * Plaintext keys print to stdout once — give to Hall. Never write them
 * to any file in this repo. Re-running rotates keys (old keys stop working).
 *
 * Usage:
 *   npx tsx scripts/gen-admin-keys.ts --local
 *   npx tsx scripts/gen-admin-keys.ts --remote
 */
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyStatements,
  parseLocalRemote,
  type D1Stmt,
} from "./lib/d1-wrangler.ts";

const SHOPS = ["bean-bloom", "paper-lantern", "terra-pots"] as const;

function main(): void {
  const { remote } = parseLocalRemote(
    process.argv.slice(2),
    "Usage: npx tsx scripts/gen-admin-keys.ts (--local | --remote)",
  );

  const keys: Record<string, string> = {};
  const stmts: D1Stmt[] = [];
  for (const shop of SHOPS) {
    const key = `afk_${randomBytes(24).toString("hex")}`;
    const keyHash = createHash("sha256").update(key).digest("hex");
    keys[shop] = key;
    stmts.push({
      sql:
        "INSERT INTO shop_admin_keys (shop, key_hash, created_at) VALUES (?, ?, datetime('now')) " +
        "ON CONFLICT(shop) DO UPDATE SET key_hash = excluded.key_hash, created_at = excluded.created_at, last_used_at = NULL",
      params: [shop, keyHash],
    });
  }

  applyStatements(stmts, remote, "gen-admin-keys");

  console.log(
    "Admin keys generated (plaintext — give these to Hall ONCE, never commit them):",
  );
  for (const shop of SHOPS) {
    console.log(`  ${shop}: ${keys[shop]}`);
  }
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
