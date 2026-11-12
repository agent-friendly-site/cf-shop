/** @jsxImportSource react */
import { createRoute } from "honox/factory";
import ProofForm from "../../../../../islands/upload/proof-form";
import type { AppEnv } from "../../../../../../src/routes/helpers";
import * as catalog from "../../../../../../src/services/catalog";
import * as orders from "../../../../../../src/services/orders";

export default createRoute(async (c) => {
  const ctx = c as typeof c & { env: AppEnv["Bindings"] };
  const slug = c.req.param("shop")!;
  const orderId = c.req.param("id")!;
  const token = c.req.query("token") || "";

  const shop = await catalog.getShop(ctx.env.DB, slug);
  if (!shop) {
    return c.render(
      <main className="mx-auto max-w-lg px-4 py-10">
        <h1 className="text-xl font-semibold">店铺不存在</h1>
        <p className="mt-2 text-muted-foreground">未知店铺：{slug}</p>
      </main>,
      { title: "店铺不存在" },
    );
  }
  const order = await orders.getOrder(ctx.env.DB, orderId);
  if (!order || order.shop !== slug) {
    return c.render(
      <main className="mx-auto max-w-lg px-4 py-10">
        <h1 className="text-xl font-semibold">订单不存在</h1>
        <p className="mt-2 text-muted-foreground">未知订单：{orderId}</p>
      </main>,
      { title: "订单不存在" },
    );
  }

  const { verifyProofUploadToken } = await import("../../../../../../src/services/payments");
  const valid = await verifyProofUploadToken(ctx.env.DB, { shop: slug, orderId, token });
  if (!valid) {
    return c.render(
      <main className="mx-auto max-w-lg px-4 py-10">
        <h1 className="text-xl font-semibold text-destructive">这个上传链接无效</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          链接可能已过期（7 天）、已经用过，或地址不对。请重新向你的 Agent 要一个新的上传链接。
        </p>
      </main>,
      { title: "链接无效" },
    );
  }
  if (!["pending_payment", "payment_submitted"].includes(order.status)) {
    return c.render(
      <main className="mx-auto max-w-lg px-4 py-10">
        <h1 className="text-xl font-semibold">这个订单已经不需要付款凭据了</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          订单 {order.id} 当前状态是 {order.status}。
        </p>
      </main>,
      { title: "无需凭据" },
    );
  }

  const itemsLabel = order.items.map((it) => `${it.name} × ${it.quantity}`).join("、");
  return c.render(
    <ProofForm
      shop={slug}
      shopName={shop.name_zh || shop.name}
      orderId={order.id}
      token={token}
      totalCny={order.total_cny}
      shippingCny={order.shipping_cny}
      itemsLabel={itemsLabel}
      status={order.status}
      paymentExpiresAt={order.payment_expires_at}
    />,
    { title: `上传付款截图 — ${shop.name_zh || shop.name}` },
  );
});
