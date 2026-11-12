/** @jsxImportSource react */
import { createRoute } from "honox/factory";

export default createRoute((c) => {
  return c.render(
    <main className="mx-auto max-w-lg px-4 py-16">
      <h1 className="text-xl font-semibold text-destructive">出错了</h1>
      <p className="mt-2 text-muted-foreground">请稍后重试，或返回店铺首页。</p>
    </main>,
    { title: "错误" },
  );
});
