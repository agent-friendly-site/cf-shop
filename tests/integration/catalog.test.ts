import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import * as db from "../../src/db";

describe("catalog service against local D1", () => {
  beforeAll(async () => {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO shops
        (slug, name, name_zh, category, description, currency)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind("bean-bloom", "Bean Bloom Coffee", "晨光咖啡", "coffee", "test shop", "CNY")
      .run();

    await env.DB.prepare(
      `INSERT OR REPLACE INTO products
        (id, shop, name, name_zh, price, currency, stock, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        "bb-yirg-250",
        "bean-bloom",
        "Yirgacheffe 250g",
        "耶加雪菲 250g",
        68,
        "CNY",
        20,
        "test product",
      )
      .run();
  });

  it("lists seeded shops", async () => {
    const shops = await db.listShops(env.DB);
    expect(shops.some((s) => s.slug === "bean-bloom")).toBe(true);
  });

  it("reads a seeded product through the service layer", async () => {
    const products = await db.listProducts(env.DB, "bean-bloom");
    expect(products).toHaveLength(1);
    expect(products[0]?.id).toBe("bb-yirg-250");
    expect(products[0]?.price).toBe(68);
    expect(products[0]?.stock).toBe(20);
  });

  it("calculates totals with shipping", () => {
    const t = db.totals(
      [{ product_id: "bb-yirg-250", quantity: 1 }],
      [
        {
          id: "bb-yirg-250",
          shop: "bean-bloom",
          name: "Yirgacheffe 250g",
          name_zh: "耶加雪菲 250g",
          price: 68,
          currency: "CNY",
          stock: 20,
          description: "",
        },
      ],
    );
    expect(t.subtotal_cny).toBe(68);
    expect(t.shipping_cny).toBe(12);
    expect(t.total_cny).toBe(80);
  });
});
