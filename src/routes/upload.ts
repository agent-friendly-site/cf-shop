// One-time payment-proof upload link (v1.6.0): the unified way for a
// buyer to submit a payment screenshot.
//
//   GET  /shops/:shop/orders/:id/upload-proof?token=...  — HonoX page (production)
//   POST /shops/:shop/orders/:id/upload-proof?token=...  — multipart upload (JSON result)
//
// Phase 5: GET HTML is app/routes/.../upload-proof; POST stays here for the island + agents.
import type { Hono } from "hono";
import { canSubmitProof } from "../domain/payment";
import * as catalog from "../services/catalog";
import * as orders from "../services/orders";
import * as payments from "../services/payments";
import type { AppEnv } from "./helpers";
import { requireProofUploadToken } from "./middleware";
import { uploadFormFieldsSchema } from "./schemas";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export type RegisterUploadOptions = {
  /** Vitest-only: register a plain-text GET so token rejection tests work without HonoX. */
  includeLegacyPages?: boolean;
};

export function registerProofUploadRoutes(app: Hono<AppEnv>, opts: RegisterUploadOptions = {}) {
  if (opts.includeLegacyPages) {
    app.get("/shops/:shop/orders/:id/upload-proof", async (c) => {
      const slug = c.req.param("shop");
      const orderId = c.req.param("id");
      const token = c.req.query("token") || "";
      const shop = await catalog.getShop(c.env.DB, slug);
      if (!shop) return c.text("店铺不存在", 404);
      const order = await orders.getOrder(c.env.DB, orderId);
      if (!order || order.shop !== slug) return c.text("订单不存在", 404);
      const valid = await payments.verifyProofUploadToken(c.env.DB, { shop: slug, orderId, token });
      if (!valid) return c.text("上传链接无效", 403);
      if (!canSubmitProof(order.status)) {
        return c.text("订单已不需要凭据", 400);
      }
      return c.text("ok", 200);
    });
  }

  app.post("/shops/:shop/orders/:id/upload-proof", async (c) => {
    const slug = c.req.param("shop");
    const orderId = c.req.param("id");
    const token = c.req.query("token") || "";
    const shop = await catalog.getShop(c.env.DB, slug);
    if (!shop) return c.json({ error: "店铺不存在" }, 404);
    const order = await orders.getOrder(c.env.DB, orderId);
    if (!order || order.shop !== slug) {
      return c.json({ error: "订单不存在" }, 404);
    }
    const tokenRow = await requireProofUploadToken(c, { shop: slug, orderId, token });
    if (!tokenRow) {
      return c.json(
        {
          error:
            "这个上传链接无效。链接可能已过期、已经用过，或者地址不对。请重新向你的 Agent 要一个新的上传链接。",
        },
        403,
      );
    }
    if (!canSubmitProof(order.status)) {
      return c.json({ error: `这个订单已经不需要付款凭据了（状态：${order.status}）` }, 400);
    }
    let body: Awaited<ReturnType<typeof c.req.parseBody>>;
    try {
      body = await c.req.parseBody();
    } catch {
      return c.json({ error: "表单解析失败，请重试。" }, 400);
    }
    const rawFile = body.file;
    if (!rawFile || typeof rawFile === "string" || rawFile.size === 0) {
      return c.json({ error: "请选择一张付款截图" }, 400);
    }
    const file = rawFile;
    if (file.size > MAX_FILE_BYTES) {
      return c.json({ error: "图片太大了，请上传 5MB 以内的图片。" }, 400);
    }
    const mime = (file.type || "").toLowerCase();
    let ext: string | undefined = ALLOWED_MIME[mime];
    if (!ext) {
      const m = /\.([a-zA-Z0-9]+)$/.exec(file.name || "");
      const byExt: Record<string, string> = {
        jpg: "jpg",
        jpeg: "jpg",
        png: "png",
        webp: "webp",
        gif: "gif",
      };
      ext = m ? byExt[m[1].toLowerCase()] : undefined;
      if (!ext) {
        return c.json({ error: "只接受图片文件（JPG / PNG / WebP / GIF）" }, 400);
      }
    }
    const fields = uploadFormFieldsSchema.safeParse({
      payment_method: typeof body.payment_method === "string" ? body.payment_method : undefined,
      transaction_id: typeof body.transaction_id === "string" ? body.transaction_id : undefined,
      amount_cny: typeof body.amount_cny === "string" ? body.amount_cny : undefined,
    });
    if (!fields.success) {
      return c.json({ error: "表单字段无效，请检查付款方式后重试。" }, 400);
    }
    const method = fields.data.payment_method;
    const transactionId = fields.data.transaction_id.trim();
    const amountRaw = parseFloat(fields.data.amount_cny);
    const amountCny = Number.isFinite(amountRaw) && amountRaw > 0 ? amountRaw : null;

    if (!ext) {
      return c.json({ error: "只接受图片文件（JPG / PNG / WebP / GIF）" }, 400);
    }
    const key = `proofs/${slug}/${orderId}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${ext}`;
    const bytes = await file.arrayBuffer();
    await c.env.PROOFS.put(key, bytes, {
      httpMetadata: { contentType: `image/${ext === "jpg" ? "jpeg" : ext}` },
    });
    await payments.addImagePaymentProof(c.env.DB, {
      orderId,
      paymentMethod: method,
      fileName: file.name || "payment.png",
      mimeType: mime || `image/${ext}`,
      fileSize: file.size,
      r2Key: key,
      transactionId: transactionId || null,
      amountCny,
    });
    await payments.consumeProofUploadToken(c.env.DB, tokenRow.token_hash);
    return c.json({
      ok: true,
      order_id: order.id,
      status: "payment_submitted",
      message: "付款截图已提交，待卖家核验",
    });
  });
}
