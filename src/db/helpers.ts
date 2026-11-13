/** Low-level D1 helpers used by repositories. */

export async function rows<T extends object = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  const { results } = await db
    .prepare(sql)
    .bind(...params)
    .all();
  return (results ?? []) as T[];
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function writeEvent(
  db: D1Database,
  {
    orderId,
    event,
    fromStatus,
    toStatus,
    actor,
    note,
    now,
  }: {
    orderId: string;
    event: string;
    fromStatus: string | null;
    toStatus: string | null;
    actor: string;
    note: string | null;
    now: string;
  },
) {
  const id = `evt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return db
    .prepare(
      "INSERT INTO order_events (id, order_id, event, from_status, to_status, actor, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id, orderId, event, fromStatus ?? null, toStatus ?? null, actor, note || null, now);
}
