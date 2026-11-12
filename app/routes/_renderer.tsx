/** @jsxImportSource react */
import { reactRenderer } from "@hono/react-renderer";

/**
 * Avoid honox/server Link/Script under the React renderer: their Fragment
 * path can become undefined in the Vite SSR worker bundle (React #130).
 * Resolve hashed assets from the Vite manifest with plain HTML tags.
 */
type ManifestFile = { file: string };
type Manifest = Record<string, ManifestFile>;

const MANIFEST_MODULES = import.meta.glob("/dist/.vite/manifest.json", {
  eager: true,
}) as Record<string, { default?: Manifest } | Manifest>;

function loadManifest(): Manifest | null {
  for (const mod of Object.values(MANIFEST_MODULES)) {
    if (!mod || typeof mod !== "object") continue;
    if ("default" in mod && mod.default && typeof mod.default === "object") {
      return mod.default as Manifest;
    }
    return mod as Manifest;
  }
  return null;
}

function viteAsset(path: string): string {
  const manifest = loadManifest();
  const entry = manifest?.[path.replace(/^\//, "")];
  if (entry?.file) return `/${entry.file}`;
  return path;
}

export default reactRenderer(({ children, title }) => {
  const css = viteAsset("/app/style.css");
  const client = viteAsset("/app/client.ts");
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="icon" href="data:," />
        <link href={css} rel="stylesheet" />
        <script type="module" src={client} async />
        <title>{title || "agent-friendly-platform"}</title>
      </head>
      <body>{children}</body>
    </html>
  );
});
