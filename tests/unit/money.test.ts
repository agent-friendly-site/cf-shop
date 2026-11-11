import { describe, expect, it } from "vitest";
import { DomainRpcError } from "../../src/domain/errors";
import { type PricedProduct, shippingForSubtotal, totals } from "../../src/domain/money";

const products: PricedProduct[] = [
  { id: "bb-yirg-250", name: "Yirgacheffe", name_zh: "耶加雪菲浅烘 250g", price: 68, stock: 42 },
  { id: "tp-mug-300", name: "Mug", name_zh: "陶土马克杯 300ml", price: 128, stock: 15 },
  { id: "tp-plate-20", name: "Plate", name_zh: "陶土餐盘 20cm", price: 98, stock: 22 },
  { id: "bb-cold-500", name: "Cold Brew", name_zh: "冷萃拼配 500g", price: 88, stock: 27 },
];

describe("totals / shipping", () => {
  it("68 + 12 shipping = 80", () => {
    const t = totals([{ product_id: "bb-yirg-250", quantity: 1 }], products);
    expect(t.subtotal_cny).toBe(68);
    expect(t.shipping_cny).toBe(12);
    expect(t.total_cny).toBe(80);
    expect(t.verbatim).toBe("68 元 + 12 元运费 = 80 元");
  });

  it("128 + 12 shipping = 140", () => {
    const t = totals([{ product_id: "tp-mug-300", quantity: 1 }], products);
    expect(t.subtotal_cny).toBe(128);
    expect(t.shipping_cny).toBe(12);
    expect(t.total_cny).toBe(140);
    expect(t.verbatim).toBe("128 元 + 12 元运费 = 140 元");
  });

  it("free shipping at exactly 200", () => {
    // 68+88+? need 200: 128+98-26?  mug+plate = 226 already free.
    // Boundary: two cold brew 88*2=176 still ships; 88+68+?
    // Use plate 98 + mug? Better: craft subtotal 200 via 68+88+? 68+132 no.
    // 88+68+44 no. Use quantity: price 68 * 0?
    // Direct shippingForSubtotal boundary + a totals case at 200 via 2*products:
    // cold 88 + yirg 68 + ? need 44 — not in catalog.
    // Use mug 128 + plate? = 226 free.
    // For exact 200: shippingForSubtotal(200) and a synthetic product.
    expect(shippingForSubtotal(199)).toBe(12);
    expect(shippingForSubtotal(200)).toBe(0);
    expect(shippingForSubtotal(201)).toBe(0);
    const exact: PricedProduct[] = [
      { id: "x-200", name: "Bundle", name_zh: "满免邮", price: 200, stock: 5 },
    ];
    const t = totals([{ product_id: "x-200", quantity: 1 }], exact);
    expect(t.subtotal_cny).toBe(200);
    expect(t.shipping_cny).toBe(0);
    expect(t.total_cny).toBe(200);
    expect(t.verbatim).toBe("200 元，满 200 元免邮，共 200 元");
  });

  it("zero subtotal has zero shipping", () => {
    expect(shippingForSubtotal(0)).toBe(0);
  });

  it("mug + plate is free shipping (226)", () => {
    const t = totals(
      [
        { product_id: "tp-mug-300", quantity: 1 },
        { product_id: "tp-plate-20", quantity: 1 },
      ],
      products,
    );
    expect(t.subtotal_cny).toBe(226);
    expect(t.shipping_cny).toBe(0);
    expect(t.total_cny).toBe(226);
  });

  it("rejects unknown product and bad qty / stock", () => {
    expect(() => totals([{ product_id: "nope" }], products)).toThrow(DomainRpcError);
    expect(() => totals([{ product_id: "tp-mug-300", quantity: 0 }], products)).toThrow(
      /bad quantity/,
    );
    expect(() => totals([{ product_id: "tp-mug-300", quantity: 99 }], products)).toThrow(
      /库存不足/,
    );
  });
});
