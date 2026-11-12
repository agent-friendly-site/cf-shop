import { z } from "zod";
import type { Product } from "../db/shared";

export const ItemShape = z.object({
  product_id: z.string(),
  quantity: z.number().int().min(1).optional(),
});

export function mcpText(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}

export function publicProduct(p: Product) {
  return {
    id: p.id,
    name: p.name,
    name_zh: p.name_zh,
    price: p.price,
    currency: p.currency,
    stock: p.stock,
    description: p.description,
    image_url: p.image_url || null,
    image_credit: p.image_credit || null,
  };
}
