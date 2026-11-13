#!/usr/bin/env npx tsx
/**
 * Update D1 shop facts from src/data without touching orders.
 *
 * Updates only shop_policies.order_statuses and shop_payment summary/flow_json
 * (seed cannot be re-run safely for partial fact refresh).
 *
 * Usage:
 *   npx tsx scripts/update-shop-facts.ts --local
 *   npx tsx scripts/update-shop-facts.ts --remote
 */
import fs from "node:fs";
import path from "node:path";
import {
  applyStatements,
  type D1Stmt,
  parseLocalRemote,
  ROOT,
  runCliScript,
} from "./lib/d1-wrangler.ts";

const DATA = path.join(ROOT, "src", "data");
const SHOPS = ["bean-bloom", "paper-lantern", "terra-pots"] as const;

function loadJson<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA, rel), "utf8")) as T;
}

function buildStatements(): D1Stmt[] {
  const stmts: D1Stmt[] = [];
  for (const slug of SHOPS) {
    const pol = loadJson<{ order_statuses: unknown }>(`shops/${slug}/policies.json`);
    const pay = loadJson<{ payment: { summary: string; flow: unknown } }>(
      `shops/${slug}/api/payment.json`,
    ).payment;
    stmts.push({
      sql: "UPDATE shop_policies SET order_statuses = ? WHERE shop = ?",
      params: [JSON.stringify(pol.order_statuses), slug],
    });
    stmts.push({
      sql: "UPDATE shop_payment SET summary = ?, flow_json = ? WHERE shop = ?",
      params: [pay.summary, JSON.stringify(pay.flow), slug],
    });
  }
  return stmts;
}

function main(): void {
  const { remote } = parseLocalRemote(
    process.argv.slice(2),
    "Usage: npx tsx scripts/update-shop-facts.ts (--local | --remote)",
  );
  const stmts = buildStatements();
  applyStatements(stmts, remote, "update-shop-facts");
  for (const slug of SHOPS) {
    console.log(`${slug}: order_statuses + payment flow updated in D1`);
  }
}

runCliScript(main, import.meta.url);
