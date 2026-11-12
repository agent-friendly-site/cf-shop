import { z } from "zod";

const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const ALLOWED_PROOF_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export const loginSchema = z.object({
  key: z.string().min(1, "请输入管理 Key"),
});
export type LoginValues = z.infer<typeof loginSchema>;

export const confirmPaymentSchema = z.object({
  verified_amount_cny: z
    .number({ error: "请输入有效金额" })
    .finite("请输入有效金额"),
});
export type ConfirmPaymentValues = z.infer<typeof confirmPaymentSchema>;

export const shipSchema = z.object({
  carrier: z.string().min(1, "请填写快递公司"),
  tracking_number: z.string().min(1, "请填写运单号"),
});
export type ShipValues = z.infer<typeof shipSchema>;

export const cancelSchema = z.object({
  reason: z.string().optional(),
});
export type CancelValues = z.infer<typeof cancelSchema>;

export const productEditSchema = z.object({
  price_cny: z
    .number({ error: "价格必须是数字" })
    .finite("价格必须是数字")
    .nonnegative("价格不能为负"),
  stock: z
    .number({ error: "库存必须是整数" })
    .int("库存必须是整数")
    .nonnegative("库存不能为负"),
});
export type ProductEditValues = z.infer<typeof productEditSchema>;

export const paymentMethodSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  instructions: z.string(),
});

export const policiesSchema = z.object({
  shipping_flat_cny: z
    .number({ error: "运费必须是数字" })
    .finite("运费必须是数字")
    .nonnegative(),
  free_over_cny: z
    .number({ error: "满额包邮必须是数字" })
    .finite("满额包邮必须是数字")
    .nonnegative(),
  lead_time: z.string().min(1, "请填写发货时效说明"),
  payment_methods: z.array(paymentMethodSchema),
});
export type PoliciesValues = z.infer<typeof policiesSchema>;

export const proofUploadSchema = z.object({
  payment_method: z.enum(["bank_transfer", "wechat_pay", "alipay"]),
  transaction_id: z.string().optional(),
  amount_cny: z.string().optional(),
  file: z
    .custom<File>((v) => typeof File !== "undefined" && v instanceof File, {
      message: "请选择一张付款截图",
    })
    .refine((f) => ALLOWED_PROOF_MIME.has(f.type) || f.type.startsWith("image/"), {
      message: "请选择图片文件（JPEG / PNG / WebP / GIF）",
    })
    .refine((f) => f.size <= MAX_PROOF_BYTES, {
      message: "图片太大了，请上传 5MB 以内的图片",
    }),
});
export type ProofUploadValues = z.infer<typeof proofUploadSchema>;

export { MAX_PROOF_BYTES };
