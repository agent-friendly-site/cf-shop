#!/usr/bin/env node
// Bundle the Hono app to a single ES module for upload with cf.py worker-put.
// esbuild resolves hono + @modelcontextprotocol/sdk + zod into one file;
// data files are inlined (JSON natively, .txt/.md/.html as text).
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync(new URL("../dist", import.meta.url), { recursive: true });

await build({
  entryPoints: ["src/index.js"],
  bundle: true,
  format: "esm",
  outfile: "dist/worker.mjs",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: false,
  loader: { ".txt": "text", ".md": "text", ".html": "text", ".xml": "text" },
  logLevel: "info",
});
console.log("built dist/worker.mjs");
