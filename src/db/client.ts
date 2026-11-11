import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

/** Create a typed Drizzle client bound to the Worker D1 database. */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Db = ReturnType<typeof createDb>;
