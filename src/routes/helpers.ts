import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Env } from "../env";
import * as catalog from "../services/catalog";
import { dataFile } from "../static/data";

export const BASE = "https://agent-friendly-platform.refined-x.workers.dev";
export const VERSION = "2.0.0";

export type AppEnv = { Bindings: Env };
export type AppContext = Context<AppEnv>;

export function text(c: AppContext, body: string, type = "text/plain; charset=utf-8") {
  return c.text(body, 200, { "Content-Type": type });
}

export function json(c: AppContext, obj: unknown, status: ContentfulStatusCode = 200) {
  return c.json(obj, status);
}

export function notFound(c: AppContext, message: string) {
  return c.json({ error: message }, 404);
}

export function dataText(rel: string): string {
  const v = dataFile(rel);
  return typeof v === "string" ? v : "";
}

export function dataJson(rel: string): Record<string, unknown> {
  const v = dataFile(rel);
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

export async function shopOr404(c: AppContext, slug: string) {
  return catalog.getShop(c.env.DB, slug);
}
