import fs from "node:fs";
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

/** Load .html/.txt/.md/.xml as default string exports (matches esbuild text loaders). */
function textModules() {
  return {
    name: "text-modules",
    enforce: "pre" as const,
    load(id: string) {
      if (!/\.(html|txt|md|xml)$/.test(id) || id.includes("\0")) return;
      const file = id.split("?")[0];
      if (!fs.existsSync(file)) return;
      const src = fs.readFileSync(file, "utf8");
      return `export default ${JSON.stringify(src)}`;
    },
  };
}

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "drizzle"));
  return {
    plugins: [
      textModules(),
      cloudflareTest({
        main: "./src/index.ts",
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      include: ["tests/integration/**/*.test.ts", "tests/unit/**/*.test.ts"],
      setupFiles: ["./tests/apply-migrations.ts"],
    },
  };
});
