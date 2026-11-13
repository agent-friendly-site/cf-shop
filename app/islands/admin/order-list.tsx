/** @jsxImportSource react */
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/app/components/ui/badge";
import { Button } from "@/app/components/ui/button";
import { Skeleton } from "@/app/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/app/components/ui/table";
import { adminKeys, fetchOrders } from "@/app/lib/admin-queries";
import {
  orderIdFromSearch,
  setAdminSearch,
  statusFromSearch,
  tabFromSearch,
  useAdminSession,
} from "@/app/lib/admin-session";
import { formatDateTime, formatMoneyCny } from "@/app/lib/format";
import { ORDER_STATUSES, statusLabel, statusVariant } from "@/app/lib/order-status";
import { getQueryClient } from "@/app/lib/query-client";

function OrderListInner({ shop }: { shop: string }) {
  const session = useAdminSession(shop);
  const [tab, setTab] = useState("orders");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const syncNav = useCallback(() => {
    setTab(tabFromSearch());
    setStatus(statusFromSearch());
    setSelected(orderIdFromSearch());
  }, []);

  useEffect(() => {
    syncNav();
    window.addEventListener("af-admin-nav", syncNav);
    window.addEventListener("popstate", syncNav);
    return () => {
      window.removeEventListener("af-admin-nav", syncNav);
      window.removeEventListener("popstate", syncNav);
    };
  }, [syncNav]);

  const ordersQuery = useQuery({
    queryKey: adminKeys.orders(shop, status),
    queryFn: () => fetchOrders(shop, status),
    enabled: session.authed && tab === "orders",
  });

  if (!session.authed || tab !== "orders") return null;

  const orders = ordersQuery.data?.orders || [];
  const counts = ordersQuery.data?.counts || {};

  return (
    <section className="mx-auto max-w-5xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">订单列表</h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void ordersQuery.refetch()}
        >
          刷新
        </Button>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {ORDER_STATUSES.map((s) => (
          <Button
            key={s.id || "all"}
            type="button"
            size="sm"
            variant={status === s.id ? "default" : "outline"}
            onClick={() => setAdminSearch({ tab: "orders", status: s.id || null })}
          >
            {s.label}
            {s.id && counts[s.id] != null ? ` (${counts[s.id]})` : ""}
          </Button>
        ))}
      </div>

      {ordersQuery.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}
      {ordersQuery.isError && (
        <p className="text-sm text-destructive">
          {(ordersQuery.error as Error).message || "加载订单失败"}
        </p>
      )}
      {!ordersQuery.isLoading && !ordersQuery.isError && orders.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">暂无订单</p>
      )}

      {orders.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>订单号</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>金额</TableHead>
              <TableHead>买家</TableHead>
              <TableHead>商品</TableHead>
              <TableHead>下单时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((o) => (
              <TableRow
                key={o.id}
                className={`cursor-pointer ${selected === o.id ? "bg-accent/50" : ""}`}
                onClick={() => setAdminSearch({ tab: "orders", order: o.id })}
              >
                <TableCell className="font-mono text-xs">{o.id}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(o.status)} title={o.status}>
                    {statusLabel(o.status)}
                  </Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap font-medium">
                  {formatMoneyCny(o.total_cny)}
                </TableCell>
                <TableCell>{o.buyer_name || "—"}</TableCell>
                <TableCell className="max-w-[14rem] truncate text-muted-foreground">
                  {(o.items || []).map((it) => `${it.name}×${it.quantity}`).join("、")}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDateTime(o.created_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

export default function OrderList({ shop }: { shop: string; shopName?: string }) {
  return (
    <QueryClientProvider client={getQueryClient()}>
      <OrderListInner shop={shop} />
    </QueryClientProvider>
  );
}
