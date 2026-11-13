/** @jsxImportSource react */
import { zodResolver } from "@hookform/resolvers/zod";
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/app/components/ui/form";
import { Input } from "@/app/components/ui/input";
import { Skeleton } from "@/app/components/ui/skeleton";
import { adminKeys, fetchOrder, postJson } from "@/app/lib/admin-queries";
import { orderIdFromSearch, setAdminSearch, useAdminSession } from "@/app/lib/admin-session";
import { formatDateTime, formatMoneyCny } from "@/app/lib/format";
import { statusLabel, statusVariant } from "@/app/lib/order-status";
import { getQueryClient } from "@/app/lib/query-client";
import {
  type CancelValues,
  type ConfirmPaymentValues,
  cancelSchema,
  confirmPaymentSchema,
  type ShipValues,
  shipSchema,
} from "@/app/lib/schemas";
import { toast } from "@/app/lib/toast";

function OrderDetailInner({ shop }: { shop: string }) {
  const session = useAdminSession(shop);
  const qc = useQueryClient();
  const [orderId, setOrderId] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const [formError, setFormError] = useState("");

  const sync = useCallback(() => setOrderId(orderIdFromSearch()), []);
  useEffect(() => {
    sync();
    window.addEventListener("af-admin-nav", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("af-admin-nav", sync);
      window.removeEventListener("popstate", sync);
    };
  }, [sync]);

  const orderQuery = useQuery({
    queryKey: adminKeys.order(shop, orderId || ""),
    queryFn: () => fetchOrder(shop, orderId!),
    enabled: session.authed && !!orderId,
  });

  const order = orderQuery.data;

  const confirmForm = useForm<ConfirmPaymentValues>({
    resolver: zodResolver(confirmPaymentSchema),
    values: { verified_amount_cny: order?.total_cny ?? 0 },
  });

  const shipForm = useForm<ShipValues>({
    resolver: zodResolver(shipSchema),
    defaultValues: { carrier: "", tracking_number: "" },
  });

  const cancelForm = useForm<CancelValues>({
    resolver: zodResolver(cancelSchema),
    defaultValues: { reason: "" },
  });

  async function invalidateOrder() {
    if (!orderId) return;
    await qc.invalidateQueries({ queryKey: adminKeys.order(shop, orderId) });
    await qc.invalidateQueries({ queryKey: adminKeys.all(shop) });
    window.dispatchEvent(new Event("af-admin-nav"));
  }

  const confirmMut = useMutation({
    mutationFn: (values: ConfirmPaymentValues) =>
      postJson(shop, `/orders/${orderId}/confirm-payment`, {
        verified_amount_cny: values.verified_amount_cny,
        note: "seller verified",
      }),
    onSuccess: async () => {
      toast("已确认收款，状态已更新");
      setFormError("");
      await invalidateOrder();
    },
    onError: (e: Error) => {
      setFormError(e.message);
      toast(e.message, "bad");
    },
  });

  const shipMut = useMutation({
    mutationFn: (values: ShipValues) =>
      postJson(shop, `/orders/${orderId}/mark-shipped`, {
        carrier: values.carrier,
        tracking_number: values.tracking_number,
      }),
    onSuccess: async () => {
      toast("已标记发货");
      setFormError("");
      await invalidateOrder();
    },
    onError: (e: Error) => {
      setFormError(e.message);
      toast(e.message, "bad");
    },
  });

  const cancelMut = useMutation({
    mutationFn: (values: CancelValues) =>
      postJson(shop, `/orders/${orderId}/cancel`, {
        reason: values.reason || "seller cancelled",
      }),
    onSuccess: async () => {
      setCancelOpen(false);
      toast("订单已取消");
      setFormError("");
      await invalidateOrder();
    },
    onError: (e: Error) => {
      setFormError(e.message);
      toast(e.message, "bad");
    },
  });

  if (!session.authed || !orderId) return null;

  if (orderQuery.isLoading) {
    return (
      <section className="mx-auto max-w-5xl px-4 pb-10">
        <Skeleton className="h-48 w-full" />
      </section>
    );
  }

  if (orderQuery.isError) {
    return (
      <section className="mx-auto max-w-5xl px-4 pb-10">
        <p className="text-sm text-destructive">
          {(orderQuery.error as Error).message || "加载详情失败"}
        </p>
      </section>
    );
  }

  if (!order) return null;

  const busy = confirmMut.isPending || shipMut.isPending || cancelMut.isPending;

  function onConfirm(values: ConfirmPaymentValues) {
    if (values.verified_amount_cny !== order!.total_cny) {
      const msg = `金额与订单总额 ${order!.total_cny} 元不符，请核对后再确认`;
      setFormError(msg);
      toast(msg, "bad");
      return;
    }
    confirmMut.mutate(values);
  }

  return (
    <section className="mx-auto max-w-5xl px-4 pb-10">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">订单详情</h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setAdminSearch({ order: null })}
          >
            关闭详情
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm">{order.id}</span>
          <Badge variant={statusVariant(order.status)} title={order.status}>
            {statusLabel(order.status)}
          </Badge>
          <span className="font-medium">{formatMoneyCny(order.total_cny)}</span>
        </div>
        <div className="mt-3 space-y-1 text-sm">
          <p>
            买家：{order.buyer_name || "—"} / {order.buyer_contact || "—"}
          </p>
          <p>地址：{order.shipping_address || "—"}</p>
          {(order.carrier || order.tracking_number) && (
            <p>
              物流：{order.carrier} {order.tracking_number}
            </p>
          )}
        </div>

        <h3 className="mt-4 text-sm font-semibold">时间线</h3>
        <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
          {order.timeline?.map((e) => (
            <li key={`${e.created_at}-${e.event}-${e.note ?? ""}`}>
              {formatDateTime(e.created_at)} · {e.event}
              {e.note ? ` — ${e.note}` : ""}
            </li>
          ))}
        </ul>

        <h3 className="mt-4 text-sm font-semibold">付款凭据</h3>
        <ul className="mt-2 space-y-3">
          {(order.proofs || []).length === 0 && (
            <li className="text-sm text-muted-foreground">暂无凭据</li>
          )}
          {order.proofs?.map((p) => {
            const src = `/shops/${shop}/admin/api/orders/${order.id}/proofs/${p.id}/image`;
            const alt = p.file_name || "proof";
            return (
              <li key={p.id} className="text-sm">
                {p.proof_type === "image" ? (
                  <button
                    type="button"
                    className="block text-left"
                    onClick={() => setLightbox({ src, alt })}
                  >
                    <img
                      src={src}
                      alt={alt}
                      className="max-h-48 rounded border border-border transition hover:opacity-90"
                    />
                    <span className="mt-1 block text-xs text-muted-foreground">点击放大</span>
                  </button>
                ) : (
                  <span>
                    交易单号 {p.transaction_id || "—"} · 金额 {p.amount_cny ?? "—"}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {order.status === "payment_submitted" && (
          <Form {...confirmForm}>
            <form
              className="mt-4 space-y-2 border-t border-border pt-4"
              onSubmit={confirmForm.handleSubmit(onConfirm)}
            >
              <FormField
                control={confirmForm.control}
                name="verified_amount_cny"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="verified">确认收款金额（元）</FormLabel>
                    <FormControl>
                      <Input
                        id="verified"
                        type="number"
                        step="0.01"
                        {...field}
                        onChange={(e) => field.onChange(e.target.valueAsNumber)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={busy}>
                {confirmMut.isPending ? "提交中…" : "确认收款"}
              </Button>
            </form>
          </Form>
        )}

        {order.status === "paid" && (
          <Form {...shipForm}>
            <form
              className="mt-4 space-y-2 border-t border-border pt-4"
              onSubmit={shipForm.handleSubmit((v) => shipMut.mutate(v))}
            >
              <FormField
                control={shipForm.control}
                name="carrier"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="carrier">快递公司</FormLabel>
                    <FormControl>
                      <Input id="carrier" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={shipForm.control}
                name="tracking_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="tracking">运单号</FormLabel>
                    <FormControl>
                      <Input id="tracking" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" disabled={busy}>
                {shipMut.isPending ? "提交中…" : "标记发货"}
              </Button>
            </form>
          </Form>
        )}

        {["pending_payment", "payment_submitted"].includes(order.status) && (
          <div className="mt-4 border-t border-border pt-4">
            <Button type="button" variant="destructive" onClick={() => setCancelOpen(true)}>
              取消订单
            </Button>
          </div>
        )}

        {formError && <p className="mt-3 text-sm text-destructive">{formError}</p>}
      </div>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认取消订单？</DialogTitle>
            <DialogDescription>取消后不可恢复为待付款。请填写原因（可选）。</DialogDescription>
          </DialogHeader>
          <Form {...cancelForm}>
            <form
              className="space-y-3"
              onSubmit={cancelForm.handleSubmit((v) => cancelMut.mutate(v))}
            >
              <FormField
                control={cancelForm.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input placeholder="取消原因" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setCancelOpen(false)}>
                  返回
                </Button>
                <Button type="submit" variant="destructive" disabled={busy}>
                  {cancelMut.isPending ? "取消中…" : "确认取消"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!lightbox} onOpenChange={(open) => !open && setLightbox(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>付款凭据</DialogTitle>
            <DialogDescription>{lightbox?.alt}</DialogDescription>
          </DialogHeader>
          {lightbox && (
            <img
              src={lightbox.src}
              alt={lightbox.alt}
              className="max-h-[70vh] w-full object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

export default function OrderDetail({ shop }: { shop: string }) {
  return (
    <QueryClientProvider client={getQueryClient()}>
      <OrderDetailInner shop={shop} />
    </QueryClientProvider>
  );
}
