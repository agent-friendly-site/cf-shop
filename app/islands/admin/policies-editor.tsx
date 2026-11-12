/** @jsxImportSource react */
import { zodResolver } from "@hookform/resolvers/zod";
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { Button } from "@/app/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/app/components/ui/form";
import { Input } from "@/app/components/ui/input";
import { Skeleton } from "@/app/components/ui/skeleton";
import { tabFromSearch, useAdminSession } from "@/app/lib/admin-session";
import { adminKeys, fetchPolicies, putJson } from "@/app/lib/admin-queries";
import { getQueryClient } from "@/app/lib/query-client";
import { type PoliciesValues, policiesSchema } from "@/app/lib/schemas";
import { toast } from "@/app/lib/toast";

function PoliciesEditorInner({ shop }: { shop: string }) {
  const session = useAdminSession(shop);
  const qc = useQueryClient();
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

  const policiesQuery = useQuery({
    queryKey: adminKeys.policies(shop),
    queryFn: () => fetchPolicies(shop),
    enabled: session.authed && tab === "policies",
  });

  const form = useForm<PoliciesValues>({
    resolver: zodResolver(policiesSchema),
    defaultValues: {
      shipping_flat_cny: 0,
      free_over_cny: 0,
      lead_time: "",
      payment_methods: [],
    },
  });

  const { fields } = useFieldArray({ control: form.control, name: "payment_methods" });

  useEffect(() => {
    if (!policiesQuery.data) return;
    const { policies, payment } = policiesQuery.data;
    const methods = (payment?.methods || []).map((m) => ({
      id: m.id,
      label: m.label,
      instructions: m.instructions || "",
    }));
    form.reset({
      shipping_flat_cny: policies.shipping_flat_cny ?? 0,
      free_over_cny: policies.free_over_cny ?? 0,
      lead_time: policies.lead_time ?? "",
      payment_methods: methods,
    });
  }, [policiesQuery.data, form]);

  const saveMut = useMutation({
    mutationFn: (values: PoliciesValues) =>
      putJson(shop, "/policies", {
        shipping_flat_cny: values.shipping_flat_cny,
        free_over_cny: values.free_over_cny,
        lead_time: values.lead_time,
        payment_methods: values.payment_methods.map((m) => ({
          id: m.id,
          instructions: m.instructions,
        })),
      }),
    onSuccess: async () => {
      toast("政策已保存");
      await qc.invalidateQueries({ queryKey: adminKeys.policies(shop) });
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });

  if (!session.authed || tab !== "policies") return null;

  const dirty = form.formState.isDirty;

  return (
    <section className="mx-auto max-w-5xl px-4 py-6">
      <h2 className="text-lg font-semibold">政策与收款</h2>

      {policiesQuery.isLoading && <Skeleton className="mt-4 h-64 max-w-xl" />}
      {policiesQuery.isError && (
        <p className="mt-4 text-sm text-destructive">
          {(policiesQuery.error as Error).message || "加载政策失败"}
        </p>
      )}

      {!policiesQuery.isLoading && !policiesQuery.isError && (
        <Form {...form}>
          <form
            className="mt-4 max-w-xl space-y-4 rounded-lg border border-border bg-card p-4"
            onSubmit={form.handleSubmit((v) => saveMut.mutate(v))}
          >
            <FormField
              control={form.control}
              name="shipping_flat_cny"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="ship">统一运费（元）</FormLabel>
                  <FormControl>
                    <Input
                      id="ship"
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
              name="free_over_cny"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="free">满额包邮（元）</FormLabel>
                  <FormControl>
                    <Input
                      id="free"
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
              name="lead_time"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="lead">发货时效说明</FormLabel>
                  <FormControl>
                    <Input id="lead" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="border-t border-border pt-4">
              <h3 className="mb-3 text-sm font-semibold">收款方式说明</h3>
              {fields.length === 0 && (
                <p className="text-sm text-muted-foreground">暂无收款方式配置</p>
              )}
              <div className="space-y-3">
                {fields.map((field, index) => (
                  <FormField
                    key={field.id}
                    control={form.control}
                    name={`payment_methods.${index}.instructions`}
                    render={({ field: f }) => (
                      <FormItem>
                        <FormLabel>
                          {form.watch(`payment_methods.${index}.label`) ||
                            form.watch(`payment_methods.${index}.id`)}
                        </FormLabel>
                        <FormControl>
                          <Input {...f} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <Button type="submit" disabled={!dirty || saveMut.isPending}>
                {saveMut.isPending ? "保存中…" : "保存政策"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!dirty || saveMut.isPending}
                onClick={() => {
                  if (!policiesQuery.data) return;
                  const { policies, payment } = policiesQuery.data;
                  form.reset({
                    shipping_flat_cny: policies.shipping_flat_cny ?? 0,
                    free_over_cny: policies.free_over_cny ?? 0,
                    lead_time: policies.lead_time ?? "",
                    payment_methods: (payment?.methods || []).map((m) => ({
                      id: m.id,
                      label: m.label,
                      instructions: m.instructions || "",
                    })),
                  });
                }}
              >
                取消
              </Button>
            </div>
          </form>
        </Form>
      )}
    </section>
  );
}

export default function PoliciesEditor({ shop }: { shop: string }) {
  return (
    <QueryClientProvider client={getQueryClient()}>
      <PoliciesEditorInner shop={shop} />
    </QueryClientProvider>
  );
}
