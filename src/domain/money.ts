/**
 * Money / shipping totals (Phase 3.3).
 * Pure functions — same formulas and error messages as the former db.totals.
 */
import { FREE_SHIPPING_OVER, SHIPPING_FLAT } from "./constants";
import { DomainRpcError } from "./errors";

export type PricedProduct = {
  id: string;
  name: string;
  name_zh: string;
  price: number;
  stock: number;
};

export type OrderItemInput = {
  product_id: string;
  quantity?: number;
};

export type OrderLineItem = {
  product_id: string;
  name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
};

export type OrderTotals = {
  lines: OrderLineItem[];
  subtotal_cny: number;
  shipping_cny: number;
  total_cny: number;
  verbatim: string;
};

export function shippingForSubtotal(subtotal: number): number {
  return subtotal >= FREE_SHIPPING_OVER || subtotal === 0 ? 0 : SHIPPING_FLAT;
}

export function totals(items: OrderItemInput[], products: PricedProduct[]): OrderTotals {
  let subtotal = 0;
  const lines: OrderLineItem[] = [];
  for (const it of items) {
    const p = products.find((x) => x.id === it.product_id);
    if (!p) {
      throw new DomainRpcError(`unknown product_id: ${it.product_id}`, -32602);
    }
    const qty = it.quantity ?? 1;
    if (!Number.isInteger(qty) || qty < 1) {
      throw new DomainRpcError(`bad quantity for ${it.product_id}`, -32602);
    }
    if (p.stock < qty) {
      throw new DomainRpcError(`${p.name_zh || p.name} 库存不足（仅剩 ${p.stock} 件）`, -32000);
    }
    subtotal += p.price * qty;
    lines.push({
      product_id: p.id,
      name: p.name_zh || p.name,
      unit_price: p.price,
      quantity: qty,
      line_total: p.price * qty,
    });
  }
  const shipping = shippingForSubtotal(subtotal);
  const total = subtotal + shipping;
  const verbatim =
    shipping === 0
      ? `${subtotal} 元，满 200 元免邮，共 ${total} 元`
      : `${subtotal} 元 + ${shipping} 元运费 = ${total} 元`;
  return { lines, subtotal_cny: subtotal, shipping_cny: shipping, total_cny: total, verbatim };
}
