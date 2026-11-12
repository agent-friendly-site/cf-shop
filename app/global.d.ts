import "@hono/react-renderer";
import type { Env } from "../src/env";

declare module "@hono/react-renderer" {
  interface Props {
    title?: string;
  }
}

declare module "hono" {
  interface Env {
    Bindings: Env;
  }
}
