/**
 * Cron sweeps are exercised here via services/jobs.
 * Production scheduled() lives on app/server.ts (Vite/HonoX entry);
 * Vitest uses src/index.ts and does not bind scheduled.
 */
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import * as db from "../../src/db";
import * as jobs from "../../src/services/jobs";

async function insertOrder(row: {
  id: string;
  status: string;
  created_at: string;
  shipped_at?: string | null;
}) {
  const now = row.created_at;
  await env.DB.prepare(
    `INSERT OR REPLACE INTO orders
      (id, shop, items_json, subtotal_cny, shipping_cny, total_cny, status,
       idempotency_key, buyer_note, shipping_address, shipped_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      row.id,
      "bean-bloom",
      JSON.stringify([
        {
          product_id: "bb-yirg-250",
          name: "耶加雪菲",
          unit_price: 68,
          quantity: 1,
          line_total: 68,
        },
      ]),
      68,
      12,
      80,
      row.status,
      `idem-${row.id}`,
      null,
      "测试地址",
      row.shipped_at ?? null,
      row.created_at,
      now,
    )
    .run();
}

describe("scheduled jobs against local D1", () => {
  beforeAll(async () => {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO shops (slug, name, name_zh, category, description, currency)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind("bean-bloom", "Bean Bloom Coffee", "晨光咖啡", "coffee", "test", "CNY")
      .run();
  });

  it("expireUnpaidOrders cancels backdated pending_payment orders", async () => {
    const staleCreated = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20 min ago
    const freshCreated = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // 5 min ago
    await insertOrder({
      id: "ord_stale_unpaid",
      status: "pending_payment",
      created_at: staleCreated,
    });
    await insertOrder({
      id: "ord_fresh_unpaid",
      status: "pending_payment",
      created_at: freshCreated,
    });

    const cancelled = await jobs.expireUnpaidOrders(env.DB, 15);
    expect(cancelled).toContain("ord_stale_unpaid");
    expect(cancelled).not.toContain("ord_fresh_unpaid");

    const stale = await db.getOrder(env.DB, "ord_stale_unpaid");
    const fresh = await db.getOrder(env.DB, "ord_fresh_unpaid");
    expect(stale?.status).toBe("cancelled");
    expect(stale?.cancel_reason).toMatch(/15 分钟未付款/);
    expect(stale?.timeline.some((e) => e.event === "auto_cancelled")).toBe(true);
    expect(fresh?.status).toBe("pending_payment");
  });

  it("autoCompleteShipped completes orders shipped more than 7 days ago", async () => {
    const oldShip = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const recentShip = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    await insertOrder({
      id: "ord_old_shipped",
      status: "shipped",
      created_at: oldShip,
      shipped_at: oldShip,
    });
    await insertOrder({
      id: "ord_recent_shipped",
      status: "shipped",
      created_at: recentShip,
      shipped_at: recentShip,
    });

    const completed = await jobs.autoCompleteShipped(env.DB, 7);
    expect(completed).toContain("ord_old_shipped");
    expect(completed).not.toContain("ord_recent_shipped");

    const old = await db.getOrder(env.DB, "ord_old_shipped");
    const recent = await db.getOrder(env.DB, "ord_recent_shipped");
    expect(old?.status).toBe("completed");
    expect(old?.timeline.some((e) => e.event === "auto_completed")).toBe(true);
    expect(recent?.status).toBe("shipped");
  });
});
