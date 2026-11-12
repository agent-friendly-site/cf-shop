import { adminErrorMessage, adminFetch, parseJson } from "./api";

export type OrderRow = {
  id: string;
  status: string;
  total_cny: number;
  buyer_name: string | null;
  created_at: string;
  items: { name: string; quantity: number }[];
};

export type AdminOrder = {
  id: string;
  status: string;
  total_cny: number;
  buyer_name: string | null;
  buyer_contact: string | null;
  shipping_address: string | null;
  carrier: string | null;
  tracking_number: string | null;
  proofs: {
    id: string;
    proof_type: string;
    transaction_id: string | null;
    amount_cny: number | null;
    file_name: string | null;
  }[];
  timeline: { event: string; created_at: string; note: string | null }[];
};

export type AdminProduct = {
  id: string;
  name: string;
  name_zh: string | null;
  price: number;
  stock: number;
};

export type AdminPolicies = {
  shipping_flat_cny?: number;
  free_over_cny?: number;
  lead_time?: string;
};

export type AdminPaymentMethod = {
  id: string;
  label?: string;
  instructions: string;
};

export type AdminPayment = {
  methods?: AdminPaymentMethod[];
} | null;

export const adminKeys = {
  all: (shop: string) => ["admin", shop] as const,
  orders: (shop: string, status: string) => [...adminKeys.all(shop), "orders", status] as const,
  order: (shop: string, id: string) => [...adminKeys.all(shop), "order", id] as const,
  products: (shop: string) => [...adminKeys.all(shop), "products"] as const,
  policies: (shop: string) => [...adminKeys.all(shop), "policies"] as const,
};

async function assertOk<T extends { error?: string }>(res: Response, data: T, fallback: string) {
  if (!res.ok) throw new Error(adminErrorMessage(data, fallback));
  return data;
}

export async function fetchOrders(shop: string, status: string) {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await adminFetch(shop, `/orders${q}`);
  const data = await parseJson<{ orders?: OrderRow[]; counts?: Record<string, number> }>(res);
  await assertOk(res, data, "加载订单失败");
  return { orders: data.orders || [], counts: data.counts || {} };
}

export async function fetchOrder(shop: string, id: string) {
  const res = await adminFetch(shop, `/orders/${id}`);
  const data = await parseJson<{ order?: AdminOrder }>(res);
  await assertOk(res, data, "加载详情失败");
  if (!data.order) throw new Error("未知订单");
  return data.order;
}

export async function fetchProducts(shop: string) {
  const res = await adminFetch(shop, "/products");
  const data = await parseJson<{ products?: AdminProduct[] }>(res);
  await assertOk(res, data, "加载商品失败");
  return data.products || [];
}

export async function fetchPolicies(shop: string) {
  const res = await adminFetch(shop, "/policies");
  const data = await parseJson<{ policies?: AdminPolicies; payment?: AdminPayment }>(res);
  await assertOk(res, data, "加载政策失败");
  return {
    policies: data.policies || {},
    payment: data.payment || null,
  };
}

export async function postJson(shop: string, path: string, body: unknown) {
  const res = await adminFetch(shop, path, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = await parseJson(res);
  await assertOk(res, data, "操作失败");
  return data;
}

export async function putJson(shop: string, path: string, body: unknown) {
  const res = await adminFetch(shop, path, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  const data = await parseJson(res);
  await assertOk(res, data, "保存失败");
  return data;
}
