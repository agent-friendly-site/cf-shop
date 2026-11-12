export const ORDER_STATUSES = [
  { id: "", label: "全部" },
  { id: "pending_payment", label: "待付款" },
  { id: "payment_submitted", label: "待核验" },
  { id: "paid", label: "已付款" },
  { id: "shipped", label: "已发货" },
  { id: "completed", label: "已完成" },
  { id: "cancelled", label: "已取消" },
] as const;

export const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  ORDER_STATUSES.filter((s) => s.id).map((s) => [s.id, s.label]),
);

export function statusLabel(status: string) {
  return STATUS_LABELS[status] || status;
}

export function statusVariant(status: string) {
  if (status === "completed" || status === "paid") return "ok" as const;
  if (status === "cancelled") return "bad" as const;
  if (status === "payment_submitted") return "warn" as const;
  return "default" as const;
}
