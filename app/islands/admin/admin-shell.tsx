/** @jsxImportSource react */
import { zodResolver } from "@hookform/resolvers/zod";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/app/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/app/components/ui/form";
import { Input } from "@/app/components/ui/input";
import { Skeleton } from "@/app/components/ui/skeleton";
import { Toaster } from "@/app/components/ui/toast";
import {
  publishAdminAuth,
  setAdminSearch,
  tabFromSearch,
  useAdminSession,
} from "@/app/lib/admin-session";
import { adminKeys } from "@/app/lib/admin-queries";
import { adminFetch, parseJson } from "@/app/lib/api";
import { getQueryClient } from "@/app/lib/query-client";
import { type LoginValues, loginSchema } from "@/app/lib/schemas";
import { toast } from "@/app/lib/toast";

const TABS = [
  { id: "orders", label: "订单" },
  { id: "products", label: "商品" },
  { id: "policies", label: "政策" },
] as const;

function LoginPanel({ shop, shopName }: { shop: string; shopName: string }) {
  const qc = useQueryClient();
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { key: "" },
  });

  async function onSubmit(values: LoginValues) {
    const res = await adminFetch(shop, "/login", {
      method: "POST",
      body: JSON.stringify({ key: values.key }),
    });
    const data = await parseJson(res);
    if (!res.ok) {
      form.setError("key", { message: "Key 不对，请检查后重试" });
      void data;
      return;
    }
    publishAdminAuth({ ready: true, authed: true });
    await qc.invalidateQueries({ queryKey: adminKeys.all(shop) });
    toast("登录成功");
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-xl font-semibold">卖家后台 — {shopName}</h1>
      <p className="mt-1 text-sm text-muted-foreground">店铺：{shop}</p>
      <Form {...form}>
        <form
          className="mt-6 space-y-3 rounded-lg border border-border bg-card p-4"
          onSubmit={form.handleSubmit(onSubmit)}
        >
          <FormField
            control={form.control}
            name="key"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="admin-key">管理 Key</FormLabel>
                <FormControl>
                  <Input
                    id="admin-key"
                    type="password"
                    placeholder="管理 Key"
                    autoComplete="current-password"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
            {form.formState.isSubmitting ? "登录中…" : "登录"}
          </Button>
        </form>
      </Form>
    </div>
  );
}

function ShellInner({ shop, shopName }: { shop: string; shopName: string }) {
  const session = useAdminSession(shop);
  const [tab, setTab] = useState("orders");

  const sync = useCallback(() => setTab(tabFromSearch()), []);
  useEffect(() => {
    sync();
    window.addEventListener("af-admin-nav", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("af-admin-nav", sync);
      window.removeEventListener("popstate", sync);
    };
  }, [sync]);

  if (!session.ready) {
    return (
      <div className="mx-auto max-w-4xl space-y-3 px-4 py-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (!session.authed) {
    return <LoginPanel shop={shop} shopName={shopName} />;
  }

  return (
    <header className="border-b border-border bg-card/60">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">卖家后台 — {shopName}</h1>
          <p className="text-xs text-muted-foreground">店铺：{shop}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => void session.logout()}>
          退出登录
        </Button>
      </div>
      <nav className="mx-auto flex max-w-5xl gap-1 px-4 pb-3">
        {TABS.map((t) => (
          <Button
            key={t.id}
            type="button"
            size="sm"
            variant={tab === t.id ? "default" : "outline"}
            onClick={() =>
              setAdminSearch({
                tab: t.id,
                order: t.id === "orders" ? undefined : null,
              })
            }
          >
            {t.label}
          </Button>
        ))}
      </nav>
    </header>
  );
}

export default function AdminShell(props: { shop: string; shopName: string }) {
  const client = getQueryClient();
  return (
    <QueryClientProvider client={client}>
      <ShellInner {...props} />
      <Toaster />
    </QueryClientProvider>
  );
}
