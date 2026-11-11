// One-time payment-proof upload link (v1.6.0): the unified way for a
// buyer to submit a payment screenshot.
//
//   GET  /shops/:shop/orders/:id/upload-proof?token=...  — upload page
//   POST /shops/:shop/orders/:id/upload-proof?token=...  — multipart upload
//
// The buyer opens the link in a browser and uploads the screenshot
// directly to the platform (R2). The image never goes through the
// buyer's agent: no agent-side image recognition, no transaction id
// to extract from a screenshot. The agent's only job is to hand the
// buyer the link (MCP tool get_payment_proof_upload_link) and then
// poll get_order until the order becomes payment_submitted.
//
// Security: the token is single-use, expires after 7 days, and only
// its SHA-256 hash is stored (see db.js). The order id alone is not
// enough — without a valid token the page and the upload both refuse.
// Uploaded images are private in R2; the seller views them through
// the authenticated admin image endpoint in src/admin.js.
import type { Hono } from "hono";
import type { Env } from "./env";
import * as db from "./db";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
type AppEnv = { Bindings: Env };

const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function esc(s: unknown) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(title: string, body: string) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;color:#222;line-height:1.6}h1{font-size:20px}.card{border:1px solid #ddd;border-radius:10px;padding:16px;margin:16px 0}label{display:block;margin:12px 0 4px;font-weight:600}input,select{width:100%;padding:10px;border:1px solid #ccc;border-radius:8px;font-size:16px;box-sizing:border-box}button{margin-top:16px;padding:12px 20px;font-size:16px;border:0;border-radius:8px;background:#222;color:#fff;width:100%}.muted{color:#666;font-size:14px}.ok{color:#1a7f37}.err{color:#b3261e}</style></head><body>${body}</body></html>`;
}

export function registerProofUploadRoutes(app: Hono<AppEnv>) {
  app.get("/shops/:shop/orders/:id/upload-proof", async (c) => {
    const slug = c.req.param("shop");
    const orderId = c.req.param("id");
    const token = c.req.query("token") || "";
    const shop = await db.getShop(c.env.DB, slug);
    if (!shop) return c.html(page("店铺不存在", `<h1>店铺不存在</h1><p>未知店铺：${esc(slug)}</p>`), 404);
    const order = await db.getOrder(c.env.DB, orderId);
    if (!order || order.shop !== slug) {
      return c.html(page("订单不存在", `<h1>订单不存在</h1><p>未知订单：${esc(orderId)}</p>`), 404);
    }
    const valid = await db.verifyProofUploadToken(c.env.DB, { shop: slug, orderId, token });
    if (!valid) {
      return c.html(
        page("链接无效",
          `<h1 class="err">这个上传链接无效</h1><p>链接可能已过期（7 天有效期）、已经用过（一次有效），或者地址不对。</p><p>请重新向你的 Agent 要一个新的上传链接。</p>`),
        403
      );
    }
    if (!["pending_payment", "payment_submitted"].includes(order.status)) {
      return c.html(
        page("订单已不需要凭据",
          `<h1>这个订单已经不需要付款凭据了</h1><p>订单 ${esc(order.id)} 当前状态是 ${esc(order.status)}。</p>`),
        400
      );
    }
    const items = order.items.map((it) => `${esc(it.name)} × ${it.quantity}`).join("、");
    return c.html(
      page("上传付款截图",
        `<h1>上传付款截图</h1>
        <div class="card">
          <div>${esc(shop.name_zh || shop.name)}</div>
          <div>订单：${esc(order.id)}</div>
          <div>商品：${items}</div>
          <div>应付：<b>${order.total_cny} 元</b>（含运费 ${order.shipping_cny} 元）</div>
          <div class="muted">状态：${order.status === "payment_submitted" ? "已提交过凭据，这次是补充上传" : "待付款"}</div>
        </div>
        <form method="post" enctype="multipart/form-data">
          <label for="payment_method">付款方式</label>
          <select name="payment_method" id="payment_method">
            <option value="bank_transfer">银行转账</option>
            <option value="wechat_pay">微信支付</option>
            <option value="alipay">支付宝</option>
          </select>
          <label for="transaction_id">交易单号（可选，不知道可不填）</label>
          <input name="transaction_id" id="transaction_id" type="text" autocomplete="off">
          <label for="amount_cny">付款金额（元，可选）</label>
          <input name="amount_cny" id="amount_cny" type="number" min="0" step="0.01" placeholder="${order.total_cny}">
          <label for="file">付款截图（图片，5MB 以内）</label>
          <input name="file" id="file" type="file" accept="image/*" required>
          <button type="submit">提交付款截图</button>
        </form>
        <p class="muted">图片只发给卖家核验用。链接一次有效，7 天内有效；提交后订单变为“待核验”，卖家核对到账和金额后发货，你的 Agent 会在状态变化时通知你。</p>`)
    );
  });

  app.post("/shops/:shop/orders/:id/upload-proof", async (c) => {
    const slug = c.req.param("shop");
    const orderId = c.req.param("id");
    const token = c.req.query("token") || "";
    const shop = await db.getShop(c.env.DB, slug);
    if (!shop) return c.html(page("店铺不存在", `<h1>店铺不存在</h1>`), 404);
    const order = await db.getOrder(c.env.DB, orderId);
    if (!order || order.shop !== slug) {
      return c.html(page("订单不存在", `<h1>订单不存在</h1>`), 404);
    }
    const tokenRow = await db.verifyProofUploadToken(c.env.DB, { shop: slug, orderId, token });
    if (!tokenRow) {
      return c.html(
        page("链接无效",
          `<h1 class="err">这个上传链接无效</h1><p>链接可能已过期、已经用过，或者地址不对。请重新向你的 Agent 要一个新的上传链接。</p>`),
        403
      );
    }
    if (!["pending_payment", "payment_submitted"].includes(order.status)) {
      return c.html(page("订单已不需要凭据", `<h1>这个订单已经不需要付款凭据了</h1><p>当前状态：${esc(order.status)}</p>`), 400);
    }
    let body;
    try {
      body = await c.req.parseBody();
    } catch {
      return c.html(page("上传失败", `<h1 class="err">上传失败</h1><p>表单解析失败，请重试。</p>`), 400);
    }
    const rawFile = body.file;
    if (!rawFile || typeof rawFile === "string" || rawFile.size === 0) {
      return c.html(page("上传失败", `<h1 class="err">请选择一张付款截图</h1><p>没有收到图片文件。</p>`), 400);
    }
    const file = rawFile;
    if (file.size > MAX_FILE_BYTES) {
      return c.html(page("上传失败", `<h1 class="err">图片太大了</h1><p>请上传 5MB 以内的图片。</p>`), 400);
    }
    const mime = (file.type || "").toLowerCase();
    let ext: string | undefined = ALLOWED_MIME[mime];
    if (!ext) {
      // Some browsers send an empty MIME type; fall back to the extension.
      const m = /\.([a-zA-Z0-9]+)$/.exec(file.name || "");
      const byExt: Record<string, string> = { jpg: "jpg", jpeg: "jpg", png: "png", webp: "webp", gif: "gif" };
      ext = m ? byExt[m[1].toLowerCase()] : undefined;
      if (!ext) {
        return c.html(page("上传失败", `<h1 class="err">只接受图片文件</h1><p>请上传 JPG / PNG / WebP / GIF 格式的付款截图。</p>`), 400);
      }
    }
    const paymentMethodRaw = body.payment_method;
    const method =
      typeof paymentMethodRaw === "string" &&
      ["bank_transfer", "wechat_pay", "alipay"].includes(paymentMethodRaw)
        ? paymentMethodRaw
        : "bank_transfer";
    const transactionId = typeof body.transaction_id === "string" ? body.transaction_id.trim() : "";
    const amountRaw = typeof body.amount_cny === "string" ? parseFloat(body.amount_cny) : NaN;
    const amountCny = Number.isFinite(amountRaw) && amountRaw > 0 ? amountRaw : null;

    if (!ext) {
      return c.html(page("上传失败", `<h1 class="err">只接受图片文件</h1><p>请上传 JPG / PNG / WebP / GIF 格式的付款截图。</p>`), 400);
    }
    const key = `proofs/${slug}/${orderId}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${ext}`;
    const bytes = await file.arrayBuffer();
    await c.env.PROOFS.put(key, bytes, { httpMetadata: { contentType: `image/${ext === "jpg" ? "jpeg" : ext}` } });
    await db.addImagePaymentProof(c.env.DB, {
      orderId,
      paymentMethod: method,
      fileName: file.name || "payment.png",
      mimeType: mime || `image/${ext}`,
      fileSize: file.size,
      r2Key: key,
      transactionId: transactionId || null,
      amountCny,
    });
    await db.consumeProofUploadToken(c.env.DB, tokenRow.token_hash);
    return c.html(
      page("凭据已提交",
        `<h1 class="ok">付款截图已提交</h1>
        <div class="card">
          <div>订单：${esc(order.id)}</div>
          <div>商品：${order.items.map((it) => `${esc(it.name)} × ${it.quantity}`).join("、")}</div>
          <div>应付：<b>${order.total_cny} 元</b></div>
          <div>状态：待核验（payment_submitted）</div>
        </div>
        <p>卖家核对到账和金额后会发货。你的 Agent 会在订单状态变化时通知你，不用再来这里查。</p>`)
    );
  });
}
