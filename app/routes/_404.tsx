/** @jsxImportSource react */
import { createRoute } from "honox/factory";

export default createRoute((c) => {
  return c.render(
    <main className="mx-auto max-w-lg px-4 py-16">
      <h1 className="text-xl font-semibold">页面不存在</h1>
      <p className="mt-2 text-muted-foreground">{c.req.path}</p>
    </main>,
    { title: "404" },
  );
});
