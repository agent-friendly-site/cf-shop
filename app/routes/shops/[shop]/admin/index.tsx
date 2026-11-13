/** @jsxImportSource react */
import { createRoute } from "honox/factory";
import type { AppEnv } from "../../../../../src/routes/helpers";
import * as catalog from "../../../../../src/services/catalog";
import AdminShell from "../../../../islands/admin/admin-shell";
import OrderDetail from "../../../../islands/admin/order-detail";
import OrderList from "../../../../islands/admin/order-list";
import PoliciesEditor from "../../../../islands/admin/policies-editor";
import ProductsEditor from "../../../../islands/admin/products-editor";

export default createRoute(async (c) => {
  const ctx = c as typeof c & { env: AppEnv["Bindings"] };
  const slug = c.req.param("shop")!;
  const shop = await catalog.getShop(ctx.env.DB, slug);
  if (!shop) {
    return c.json({ error: `unknown shop: ${slug}` }, 404);
  }

  const name = shop.name_zh || shop.name;
  return c.render(
    <div>
      <AdminShell shop={slug} shopName={name} />
      <OrderList shop={slug} />
      <OrderDetail shop={slug} />
      <ProductsEditor shop={slug} />
      <PoliciesEditor shop={slug} />
    </div>,
    { title: `卖家后台 — ${name}` },
  );
});
