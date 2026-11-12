/**
 * Zod schemas for write-path request bodies (Phase 4.1).
 * Keep validation messages compatible with existing admin/upload UX.
 */
import { z } from "zod";

export const loginBodySchema = z.object({
  key: z.string().min(1),
});

export const confirmPaymentBodySchema = z.object({
  verified_amount_cny: z.coerce.number(),
  note: z.string().optional(),
});

export const markShippedBodySchema = z.object({
  carrier: z.string().optional(),
  tracking_number: z.string().optional(),
});

export const cancelOrderBodySchema = z.object({
  reason: z.string().optional(),
});

export const updateProductBodySchema = z.object({
  price_cny: z.coerce.number(),
  stock: z.coerce.number(),
});

/** Policies PATCH: allow known fields + payment_methods; ignore unknown. */
export const updatePoliciesBodySchema = z
  .object({
    shipping_flat_cny: z.coerce.number().optional(),
    free_over_cny: z.coerce.number().optional(),
    lead_time: z.string().optional(),
    returns_window_days: z.coerce.number().optional(),
    returns_condition: z.string().optional(),
    return_shipping: z.string().optional(),
    privacy: z.string().optional(),
    payment_methods: z
      .array(
        z.object({
          id: z.string().min(1),
          instructions: z.string(),
        }),
      )
      .optional(),
  })
  .passthrough();

export const uploadFormFieldsSchema = z.object({
  payment_method: z.enum(["bank_transfer", "wechat_pay", "alipay"]).default("bank_transfer"),
  transaction_id: z.string().default(""),
  amount_cny: z.string().default(""),
});

export function zodErrorMessage(err: z.ZodError): string {
  return err.issues[0]?.message || "invalid request body";
}
