/**
 * Shared wrangler D1 execute helper for ops scripts (one SQL file batch).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DB_NAME = "agent-friendly-orders";

export type D1Stmt = { sql: string; params: unknown[] };

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

export function renderSql(stmt: D1Stmt): string {
  let i = 0;
  return stmt.sql.replaceAll("?", () => {
    if (i >= stmt.params.length) throw new Error(`not enough params for: ${stmt.sql}`);
    return sqlLiteral(stmt.params[i++]);
  });
}

export function applyStatements(stmts: D1Stmt[], remote: boolean, label: string): void {
  const scope = remote ? "remote" : "local";
  const tmp = path.join(ROOT, ".wrangler", `${label}-${scope}.sql`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, `${stmts.map(renderSql).join(";\n")};\n`, "utf8");
  console.log(`applying ${stmts.length} statements via wrangler (${scope})…`);
  execFileSync("npx", ["wrangler", "d1", "execute", DB_NAME, `--${scope}`, "--file", tmp], {
    cwd: ROOT,
    stdio: "inherit",
  });
}

export function runCliScript(main: () => void, moduleUrl: string): void {
  const entry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl);
  if (!entry) return;
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

export function parseLocalRemote(argv: string[], usage: string): { remote: boolean } {
  let local = false;
  let remote = false;
  for (const a of argv) {
    if (a === "--local") local = true;
    else if (a === "--remote") remote = true;
    else if (a === "--help" || a === "-h") {
      console.log(usage);
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${a}`);
    }
  }
  if (local === remote) {
    throw new Error("pick exactly one of --local | --remote");
  }
  return { remote };
}
