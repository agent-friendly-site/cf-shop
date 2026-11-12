#!/usr/bin/env node
import { mkdirSync } from "node:fs";
// Bundle the Hono app to a single ES module for upload with cf.py worker-put.
// esbuild resolves hono + @modelcontextprotocol/sdk + zod into one file;
// data files are inlined (JSON natively, .txt/.md/.html as text).
import { build } from "esbuild";

mkdirSync(new URL("../dist", import.meta.url), { recursive: true });

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "esm",
  outfile: "dist/worker.mjs",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: false,
  loader: { ".txt": "text", ".md": "text", ".html": "text", ".xml": "text" },
  // gen-data emits `?raw` for Vite; strip query so esbuild text loaders still apply.
  plugins: [
    {
      name: "strip-raw-query",
      setup(build) {
        build.onResolve({ filter: /\?(raw)$/ }, (args) => ({
          path: args.path.replace(/\?raw$/, ""),
          namespace: args.namespace,
        }));
      },
    },
  ],
  logLevel: "info",
});
console.log("built dist/worker.mjs");
