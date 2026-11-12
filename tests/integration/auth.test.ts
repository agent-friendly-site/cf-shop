import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/db/shared";
import * as orders from "../../src/services/orders";
import * as payments from "../../src/services/payments";

const SHOP = "bean-bloom";
const ADMIN_KEY = "test-admin-key-phase4";

describe("admin + proof-upload auth", () => {
  beforeAll(async () => {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO shops (slug, name, name_zh, category, description, currency)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(SHOP, "Bean Bloom Coffee", "晨光咖啡", "coffee", "test", "CNY")
      .run();

    await env.DB.prepare(
      `INSERT OR REPLACE INTO shop_admin_keys (shop, key_hash, created_at)
       VALUES (?, ?, ?)`,
    )
      .bind(SHOP, await sha256Hex(ADMIN_KEY), new Date().toISOString())
      .run();

    await env.DB.prepare(
      `INSERT OR REPLACE INTO products
        (id, shop, name, name_zh, price, currency, stock, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind("bb-yirg-250", SHOP, "Yirgacheffe", "耶加雪菲", 68, "CNY", 20, "test")
      .run();
  });

  it("rejects admin API without key (401)", async () => {
    const res = await SELF.fetch(`https://example.com/shops/${SHOP}/admin/api/me`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/admin authentication required/);
  });

  it("rejects admin API with wrong key (401)", async () => {
    const res = await SELF.fetch(`https://example.com/shops/${SHOP}/admin/api/me`, {
      headers: { Authorization: "Bearer wrong-key" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts admin API with correct Bearer key", async () => {
    const res = await SELF.fetch(`https://example.com/shops/${SHOP}/admin/api/me`, {
      headers: { Authorization: `Bearer ${ADMIN_KEY}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { shop: string };
    expect(body.shop).toBe(SHOP);
  });

  it("rejects proof upload page without token (403)", async () => {
    const products = [
      {
        id: "bb-yirg-250",
        name: "Yirgacheffe",
        name_zh: "耶加雪菲",
        price: 68,
        currency: "CNY",
        stock: 20,
        description: "t",
        shop: SHOP,
      },
    ];
    const total = orders.totals([{ product_id: "bb-yirg-250", quantity: 1 }], products);
    const created = await orders.createOrder(env.DB, {
      shop: SHOP,
      items: [{ product_id: "bb-yirg-250", quantity: 1 }],
      total,
      idempotencyKey: `idem-auth-upload-${Date.now()}`,
      shippingAddress: "测试地址",
    });
    expect(created.order).toBeTruthy();
    const orderId = created.order?.id;
    expect(orderId).toBeTruthy();
    const res = await SELF.fetch(
      `https://example.com/shops/${SHOP}/orders/${orderId}/upload-proof`,
    );
    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).toMatch(/上传链接无效/);
  });

  it("rejects proof upload with used token (403)", async () => {
    const products = [
      {
        id: "bb-yirg-250",
        name: "Yirgacheffe",
        name_zh: "耶加雪菲",
        price: 68,
        currency: "CNY",
        stock: 20,
        description: "t",
        shop: SHOP,
      },
    ];
    const total = orders.totals([{ product_id: "bb-yirg-250", quantity: 1 }], products);
    const created = await orders.createOrder(env.DB, {
      shop: SHOP,
      items: [{ product_id: "bb-yirg-250", quantity: 1 }],
      total,
      idempotencyKey: `idem-auth-used-${Date.now()}`,
      shippingAddress: "测试地址",
    });
    const orderId = created.order?.id;
    expect(orderId).toBeTruthy();
    const link = await payments.createProofUploadToken(env.DB, {
      shop: SHOP,
      orderId: orderId as string,
    });
    const row = await payments.verifyProofUploadToken(env.DB, {
      shop: SHOP,
      orderId: orderId as string,
      token: link.token,
    });
    expect(row?.token_hash).toBeTruthy();
    await payments.consumeProofUploadToken(env.DB, row?.token_hash as string);

    const res = await SELF.fetch(
      `https://example.com/shops/${SHOP}/orders/${orderId}/upload-proof?token=${link.token}`,
    );
    expect(res.status).toBe(403);
  });

  it("rejects proof upload with time-expired token (403)", async () => {
    const products = [
      {
        id: "bb-yirg-250",
        name: "Yirgacheffe",
        name_zh: "耶加雪菲",
        price: 68,
        currency: "CNY",
        stock: 20,
        description: "t",
        shop: SHOP,
      },
    ];
    const total = orders.totals([{ product_id: "bb-yirg-250", quantity: 1 }], products);
    const created = await orders.createOrder(env.DB, {
      shop: SHOP,
      items: [{ product_id: "bb-yirg-250", quantity: 1 }],
      total,
      idempotencyKey: `idem-auth-time-expired-${Date.now()}`,
      shippingAddress: "测试地址",
    });
    const orderId = created.order?.id;
    expect(orderId).toBeTruthy();
    const link = await payments.createProofUploadToken(env.DB, {
      shop: SHOP,
      orderId: orderId as string,
    });
    const row = await payments.verifyProofUploadToken(env.DB, {
      shop: SHOP,
      orderId: orderId as string,
      token: link.token,
    });
    expect(row?.token_hash).toBeTruthy();
    // Backdate expires_at so matchProofUploadToken rejects as expired (not used).
    const past = new Date(Date.now() - 60_000).toISOString();
    await env.DB.prepare("UPDATE proof_upload_tokens SET expires_at = ? WHERE token_hash = ?")
      .bind(past, row?.token_hash as string)
      .run();

    const still = await payments.verifyProofUploadToken(env.DB, {
      shop: SHOP,
      orderId: orderId as string,
      token: link.token,
    });
    expect(still).toBeNull();

    const res = await SELF.fetch(
      `https://example.com/shops/${SHOP}/orders/${orderId}/upload-proof?token=${link.token}`,
    );
    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).toMatch(/上传链接无效/);
  });
});
