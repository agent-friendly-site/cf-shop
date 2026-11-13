/** @jsxImportSource react */
import { zodResolver } from "@hookform/resolvers/zod";
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/app/components/ui/button";
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
import { type AdminProduct, adminKeys, fetchProducts, putJson } from "@/app/lib/admin-queries";
import { tabFromSearch, useAdminSession } from "@/app/lib/admin-session";
import { getQueryClient } from "@/app/lib/query-client";
import { type ProductEditValues, productEditSchema } from "@/app/lib/schemas";
import { toast } from "@/app/lib/toast";

function ProductRow({ shop, product }: { shop: string; product: AdminProduct }) {
  const qc = useQueryClient();
  const form = useForm<ProductEditValues>({
    resolver: zodResolver(productEditSchema),
    values: { price_cny: product.price, stock: product.stock },
  });

  const dirty = form.formState.isDirty;

  const saveMut = useMutation({
    mutationFn: (values: ProductEditValues) =>
      putJson(shop, `/products/${product.id}`, {
        price_cny: values.price_cny,
        stock: values.stock,
      }),
    onSuccess: async () => {
      toast(`${product.id} 已保存`);
      await qc.invalidateQueries({ queryKey: adminKeys.products(shop) });
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });

  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="font-medium">{product.name_zh || product.name}</div>
      <div className="text-xs text-muted-foreground">{product.id}</div>
      <Form {...form}>
        <form
          className="mt-3 grid gap-3 sm:grid-cols-2"
          onSubmit={form.handleSubmit((v) => saveMut.mutate(v))}
        >
          <FormField
            control={form.control}
            name="price_cny"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor={`price-${product.id}`}>价格（元）</FormLabel>
                <FormControl>
                  <Input
                    id={`price-${product.id}`}
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
          <FormField
            control={form.control}
            name="stock"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor={`stock-${product.id}`}>库存</FormLabel>
                <FormControl>
                  <Input
                    id={`stock-${product.id}`}
                    type="number"
                    step="1"
                    {...field}
                    onChange={(e) => field.onChange(e.target.valueAsNumber)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" size="sm" disabled={!dirty || saveMut.isPending}>
              {saveMut.isPending ? "保存中…" : "保存"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!dirty || saveMut.isPending}
              onClick={() => form.reset({ price_cny: product.price, stock: product.stock })}
            >
              取消
            </Button>
          </div>
        </form>
      </Form>
    </li>
  );
}

function ProductsEditorInner({ shop }: { shop: string }) {
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

  const productsQuery = useQuery({
    queryKey: adminKeys.products(shop),
    queryFn: () => fetchProducts(shop),
    enabled: session.authed && tab === "products",
  });

  if (!session.authed || tab !== "products") return null;

  return (
    <section className="mx-auto max-w-5xl px-4 py-6">
      <h2 className="text-lg font-semibold">商品管理</h2>

      {productsQuery.isLoading && (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      )}
      {productsQuery.isError && (
        <p className="mt-4 text-sm text-destructive">
          {(productsQuery.error as Error).message || "加载商品失败"}
        </p>
      )}
      {!productsQuery.isLoading &&
        !productsQuery.isError &&
        (productsQuery.data || []).length === 0 && (
          <p className="mt-6 text-sm text-muted-foreground">暂无商品</p>
        )}

      <ul className="mt-4 space-y-4">
        {(productsQuery.data || []).map((p) => (
          <ProductRow key={p.id} shop={shop} product={p} />
        ))}
      </ul>
    </section>
  );
}

export default function ProductsEditor({ shop }: { shop: string }) {
  return (
    <QueryClientProvider client={getQueryClient()}>
      <ProductsEditorInner shop={shop} />
    </QueryClientProvider>
  );
}
