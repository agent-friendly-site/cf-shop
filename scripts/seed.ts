#!/usr/bin/env npx tsx
/**
 * Seed agent-friendly-orders D1 from src/data.
 *
 * Apply uses wrangler (OAuth). For partial policy/payment refresh without
 * replaying seed, use scripts/update-shop-facts.ts.
 *
 * Usage:
 *   npx tsx scripts/seed.ts --dump
 *   npx tsx scripts/seed.ts --local
 *   npx tsx scripts/seed.ts --remote
 *   npx tsx scripts/seed.ts --remote --migrate-order /path/to/do_order.json
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "src", "data");
const DB_NAME = "agent-friendly-orders";

export type SeedStmt = { sql: string; params: unknown[] };

function load<T = Record<string, unknown>>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA, rel), "utf8")) as T;
}

/**
 * Nested JSON columns use Python-compatible `json.dumps` defaults
 * (ensure_ascii=True, separators=(", ", ": ")) for stable D1 bytes.
 */
function dumps(value: unknown): string {
  const escapeStr = (s: string) => {
    let out = '"';
    for (const ch of s) {
      const c = ch.codePointAt(0) ?? 0;
      if (ch === '"') out += '\\"';
      else if (ch === "\\") out += "\\\\";
      else if (ch === "\b") out += "\\b";
      else if (ch === "\f") out += "\\f";
      else if (ch === "\n") out += "\\n";
      else if (ch === "\r") out += "\\r";
      else if (ch === "\t") out += "\\t";
      else if (c < 0x20 || c > 0x7e) {
        if (c > 0xffff) {
          const cp = c - 0x10000;
          const hi = 0xd800 + (cp >> 10);
          const lo = 0xdc00 + (cp & 0x3ff);
          out += `\\u${hi.toString(16).padStart(4, "0")}\\u${lo.toString(16).padStart(4, "0")}`;
        } else {
          out += `\\u${c.toString(16).padStart(4, "0")}`;
        }
      } else out += ch;
    }
    return `${out}"`;
  };
  const enc = (v: unknown): string => {
    if (v === null || v === undefined) return "null";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "number") {
      if (!Number.isFinite(v)) return "null";
      return String(v);
    }
    if (typeof v === "string") return escapeStr(v);
    if (Array.isArray(v)) return `[${v.map(enc).join(", ")}]`;
    if (typeof v === "object") {
      const entries = Object.entries(v as Record<string, unknown>).map(
        ([k, val]) => `${escapeStr(k)}: ${enc(val)}`,
      );
      return `{${entries.join(", ")}}`;
    }
    throw new Error(`dumps: unsupported type ${typeof v}`);
  };
  return enc(value);
}

/** Build INSERT/REPLACE statements from src/data. */
export function buildStatements(migrateOrderPath: string | null = null): SeedStmt[] {
  const stmts: SeedStmt[] = [];
  const shopsJson = load<{ shops: Record<string, unknown>[] }>("shops.json");
  for (const entry of shopsJson.shops) {
    const slug = entry.slug as string;
    const agent = load<Record<string, unknown>>(`shops/${slug}/agent.json`);
    const pres = load<{ location?: Record<string, unknown> }>(
      `shops/${slug}/api/presentation.json`,
    );
    const loc = pres.location || {};
    stmts.push({
      sql: "INSERT OR REPLACE INTO shops (slug, name, name_zh, category, description, city, latitude, longitude, address, pickup, currency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      params: [
        slug,
        entry.name,
        entry.name_zh ?? null,
        entry.category ?? null,
        agent.description ?? null,
        loc.city ?? null,
        loc.latitude ?? null,
        loc.longitude ?? null,
        loc.address ?? null,
        loc.pickup ?? null,
        "CNY",
      ],
    });
    const products = load<{ products: Record<string, unknown>[] }>(
      `shops/${slug}/api/products.json`,
    );
    for (const p of products.products) {
      stmts.push({
        sql: "INSERT OR REPLACE INTO products (id, shop, name, name_zh, price, currency, stock, description, url, image_url, image_credit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params: [
          p.id,
          slug,
          p.name,
          p.name_zh ?? null,
          p.price,
          p.currency ?? "CNY",
          p.stock,
          p.description ?? null,
          p.url ?? null,
          p.image_url ?? null,
          p.image_credit ?? null,
        ],
      });
    }
    const pol = load<{
      shipping: Record<string, unknown>;
      returns: Record<string, unknown>;
      privacy?: unknown;
      order_statuses?: unknown;
    }>(`shops/${slug}/policies.json`);
    stmts.push({
      sql: "INSERT OR REPLACE INTO shop_policies (shop, shipping_flat_cny, free_over_cny, lead_time, returns_window_days, returns_condition, return_shipping, privacy, order_statuses) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      params: [
        slug,
        pol.shipping.flat_fee_cny,
        pol.shipping.free_over_cny,
        pol.shipping.lead_time,
        pol.returns.window_days,
        pol.returns.condition ?? null,
        pol.returns.return_shipping ?? null,
        pol.privacy ?? null,
        dumps(pol.order_statuses ?? []),
      ],
    });
    const pay = load<{
      payment: {
        summary: string;
        flow: unknown;
        never_in_chat?: unknown;
        methods: { id: string; label: string; instructions: string }[];
      };
    }>(`shops/${slug}/api/payment.json`).payment;
    for (const m of pay.methods) {
      stmts.push({
        sql: "INSERT OR REPLACE INTO payment_methods (shop, method_id, label, instructions) VALUES (?, ?, ?, ?)",
        params: [slug, m.id, m.label, m.instructions],
      });
    }
    stmts.push({
      sql: "INSERT OR REPLACE INTO shop_payment (shop, summary, flow_json, never_in_chat_json) VALUES (?, ?, ?, ?)",
      params: [slug, pay.summary, dumps(pay.flow), dumps(pay.never_in_chat ?? [])],
    });
    const recs = load<{
      recommendations: Record<string, unknown>[];
      bundles?: { name: string; items: unknown; total_cny: number; note?: string }[];
    }>(`shops/${slug}/api/recommendations.json`);
    for (const [i, r] of recs.recommendations.entries()) {
      stmts.push({
        sql: "INSERT OR REPLACE INTO recommendations (shop, product_id, best_for, why, alternative_if_out, rank) VALUES (?, ?, ?, ?, ?, ?)",
        params: [
          slug,
          r.product_id,
          r.best_for ?? null,
          r.why ?? null,
          r.alternative_if_out ?? null,
          i,
        ],
      });
    }
    for (const b of recs.bundles ?? []) {
      stmts.push({
        sql: "INSERT OR REPLACE INTO shop_bundles (shop, name, items_json, total_cny, note) VALUES (?, ?, ?, ?, ?)",
        params: [slug, b.name, dumps(b.items), b.total_cny, b.note ?? null],
      });
    }
  }

  if (migrateOrderPath) {
    const wrapped = JSON.parse(fs.readFileSync(migrateOrderPath, "utf8")) as {
      result: { content: { text: string }[] };
    };
    const o = JSON.parse(wrapped.result.content[0].text).order as Record<string, unknown> & {
      items: unknown;
      proofs?: Record<string, unknown>[];
    };
    stmts.push({
      sql: "INSERT OR REPLACE INTO orders (id, shop, items_json, subtotal_cny, shipping_cny, total_cny, status, idempotency_key, buyer_note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      params: [
        o.id,
        o.shop,
        dumps(o.items),
        o.subtotal_cny,
        o.shipping_cny,
        o.total_cny,
        o.status,
        o.idempotency_key,
        o.buyer_note ?? null,
        o.created_at,
        o.updated_at,
      ],
    });
    for (const pr of o.proofs ?? []) {
      stmts.push({
        sql: "INSERT OR REPLACE INTO payment_proofs (id, order_id, payment_method, transaction_id, amount_cny, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        params: [
          pr.id,
          pr.order_id,
          pr.payment_method,
          pr.transaction_id,
          pr.amount_cny,
          pr.created_at,
        ],
      });
    }
  }
  return stmts;
}

function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`non-finite number: ${v}`);
    return String(v);
  }
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "string") return `'${v.replaceAll("'", "''")}'`;
  throw new Error(`unsupported param type: ${typeof v}`);
}

/** Bind `?` placeholders for wrangler --file execution. */
export function renderSql(stmt: SeedStmt): string {
  let i = 0;
  return stmt.sql.replaceAll("?", () => {
    if (i >= stmt.params.length) throw new Error(`not enough params for: ${stmt.sql}`);
    return sqlLiteral(stmt.params[i++]);
  });
}

function applyStatements(stmts: SeedStmt[], remote: boolean): void {
  const tmp = path.join(ROOT, ".wrangler", `seed-${remote ? "remote" : "local"}.sql`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  // One statement per line; wrangler executes the file as a batch.
  fs.writeFileSync(tmp, `${stmts.map(renderSql).join(";\n")};\n`, "utf8");
  const args = [
    "wrangler",
    "d1",
    "execute",
    DB_NAME,
    remote ? "--remote" : "--local",
    "--file",
    tmp,
  ];
  console.log(`applying ${stmts.length} statements via wrangler (${remote ? "remote" : "local"})…`);
  execFileSync("npx", args, { cwd: ROOT, stdio: "inherit" });
  console.log("seed done");
}

function parseArgs(argv: string[]) {
  let dump = false;
  let local = false;
  let remote = false;
  let migrateOrder: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dump") dump = true;
    else if (a === "--local") local = true;
    else if (a === "--remote") remote = true;
    else if (a === "--migrate-order") {
      migrateOrder = argv[++i] ?? null;
      if (!migrateOrder) throw new Error("--migrate-order needs a path");
    } else if (a === "--help" || a === "-h") {
      console.log(
        `Usage: npx tsx scripts/seed.ts (--dump | --local | --remote) [--migrate-order PATH]`,
      );
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${a}`);
    }
  }
  if ([dump, local, remote].filter(Boolean).length !== 1) {
    throw new Error("pick exactly one of --dump | --local | --remote");
  }
  return { dump, local, remote, migrateOrder };
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const stmts = buildStatements(opts.migrateOrder);
  if (opts.dump) {
    // One JSON object per line.
    for (const s of stmts) {
      process.stdout.write(`${JSON.stringify(s)}\n`);
    }
    return;
  }
  applyStatements(stmts, opts.remote);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
