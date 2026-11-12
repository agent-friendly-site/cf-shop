/** @jsxImportSource react */
import { zodResolver } from "@hookform/resolvers/zod";
import { QueryClientProvider, useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/app/components/ui/select";
import { Toaster } from "@/app/components/ui/toast";
import { getQueryClient } from "@/app/lib/query-client";
import { type ProofUploadValues, proofUploadSchema } from "@/app/lib/schemas";
import { toast } from "@/app/lib/toast";

export type ProofFormProps = {
  shop: string;
  shopName: string;
  orderId: string;
  token: string;
  totalCny: number;
  shippingCny: number;
  itemsLabel: string;
  status: string;
  paymentExpiresAt: string | null;
};

function formatRemain(ms: number) {
  if (ms <= 0) return "已截止";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function ProofFormInner(props: ProofFormProps) {
  const [now, setNow] = useState(() => Date.now());
  const [preview, setPreview] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const expiresMs = props.paymentExpiresAt ? new Date(props.paymentExpiresAt).getTime() : null;
  const remain = expiresMs == null ? null : expiresMs - now;
  const expired = remain != null && remain <= 0;

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors },
  } = useForm<ProofUploadValues>({
    resolver: zodResolver(proofUploadSchema),
    defaultValues: {
      payment_method: "bank_transfer",
      transaction_id: "",
      amount_cny: String(props.totalCny),
      file: undefined,
    },
  });

  const file = watch("file");
  const method = watch("payment_method");

  useEffect(() => {
    if (expiresMs == null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresMs]);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const statusLabel = useMemo(() => {
    if (props.status === "payment_submitted") return "已提交过凭据，这次是补充上传";
    return "待付款";
  }, [props.status]);

  const uploadMut = useMutation({
    mutationFn: async (values: ProofUploadValues) => {
      const fd = new FormData();
      fd.set("payment_method", values.payment_method);
      fd.set("transaction_id", values.transaction_id || "");
      fd.set("amount_cny", values.amount_cny || "");
      fd.set("file", values.file);
      const res = await fetch(
        `/shops/${props.shop}/orders/${props.orderId}/upload-proof?token=${encodeURIComponent(props.token)}`,
        { method: "POST", body: fd },
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(
          data.error ||
            (res.status === 403 ? "链接无效或已用过，请向 Agent 重新要链接" : "上传失败，请重试"),
        );
      }
      return data;
    },
    onSuccess: () => {
      setDone(true);
      toast("提交成功 · 待核验");
    },
    onError: (e: Error) => {
      setError("root", { message: e.message });
      toast(e.message, "bad");
    },
  });

  function onSubmit(values: ProofUploadValues) {
    if (expired) {
      setError("root", { message: "付款窗口已过期，订单将自动取消，请重新下单" });
      return;
    }
    uploadMut.mutate(values);
  }

  if (done) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <h1 className="text-xl font-semibold text-emerald-800">提交成功 · 待核验</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          截图已交给卖家核验。你的 Agent 会在订单状态变化时通知你，不用再回到这个页面查询。
        </p>
      </div>
    );
  }

  if (expired) {
    return (
      <div className="mx-auto max-w-lg px-4 py-10">
        <h1 className="text-xl font-semibold text-destructive">订单已取消</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          下单后 15 分钟未提交付款凭据，订单已过期。请让 Agent 重新下单后再获取上传链接。
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <h1 className="text-xl font-semibold">上传付款截图</h1>
      <div className="mt-4 rounded-lg border border-border bg-card p-4 text-sm leading-relaxed">
        <div>{props.shopName}</div>
        <div>订单：{props.orderId}</div>
        <div>商品：{props.itemsLabel}</div>
        <div>
          应付：<strong>{props.totalCny} 元</strong>（含运费 {props.shippingCny} 元）
        </div>
        <div className="text-muted-foreground">状态：{statusLabel}</div>
        {remain != null && (
          <div className="mt-2 font-medium">付款截止倒计时：{formatRemain(remain)}</div>
        )}
      </div>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit(onSubmit)}>
        <div>
          <Label>付款方式</Label>
          <div className="mt-1">
            <Select
              value={method}
              onValueChange={(v) =>
                setValue("payment_method", v as ProofUploadValues["payment_method"], {
                  shouldValidate: true,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="选择付款方式" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bank_transfer">银行转账</SelectItem>
                <SelectItem value="wechat_pay">微信支付</SelectItem>
                <SelectItem value="alipay">支付宝</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="transaction_id">交易单号（可选）</Label>
          <Input id="transaction_id" className="mt-1" autoComplete="off" {...register("transaction_id")} />
        </div>
        <div>
          <Label htmlFor="amount_cny">付款金额（元，可选）</Label>
          <Input id="amount_cny" className="mt-1" type="number" min={0} step="0.01" {...register("amount_cny")} />
        </div>
        <div>
          <Label htmlFor="file">付款截图（图片，5MB 以内）</Label>
          <Controller
            name="file"
            control={control}
            render={({ field: { onChange, onBlur, name, ref } }) => (
              <Input
                id="file"
                className="mt-1"
                type="file"
                accept="image/*"
                name={name}
                ref={ref}
                onBlur={onBlur}
                onChange={(e) => onChange(e.target.files?.[0] ?? undefined)}
              />
            )}
          />
          {file && (
            <p className="mt-1 text-xs text-muted-foreground">
              {file.name} · {(file.size / 1024).toFixed(1)} KB
              <button
                type="button"
                className="ml-2 underline"
                onClick={() => setValue("file", undefined as unknown as File, { shouldValidate: true })}
              >
                清除
              </button>
            </p>
          )}
          {preview && (
            <img
              src={preview}
              alt="付款截图预览"
              className="mt-3 max-h-56 rounded-md border border-border object-contain"
            />
          )}
          {errors.file && <p className="mt-1 text-sm text-destructive">{errors.file.message}</p>}
        </div>
        {errors.root && <p className="text-sm text-destructive">{errors.root.message}</p>}
        <Button type="submit" className="w-full" disabled={uploadMut.isPending} size="lg">
          {uploadMut.isPending ? "提交中…" : "提交付款截图"}
        </Button>
      </form>
      <p className="mt-4 text-xs text-muted-foreground">
        图片只发给卖家核验。链接一次有效；提交后订单变为「待核验」。
      </p>
    </div>
  );
}

export default function ProofForm(props: ProofFormProps) {
  return (
    <QueryClientProvider client={getQueryClient()}>
      <ProofFormInner {...props} />
      <Toaster />
    </QueryClientProvider>
  );
}
