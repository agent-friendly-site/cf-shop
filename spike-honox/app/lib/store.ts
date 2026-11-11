/** Cookie-backed mock store for the Phase 0 spike (Workers isolates have no shared memory). */

export type OrderStatus =
  | 'pending_payment'
  | 'payment_submitted'
  | 'paid'
  | 'shipped'
  | 'completed'
  | 'cancelled'

export type Order = {
  id: string
  shop: string
  product: string
  total_cny: number
  buyer: string
  status: OrderStatus
  created_at: string
}

const SEED: Omit<Order, 'shop' | 'status'>[] = [
  {
    id: 'ord_spike_001',
    product: 'Yirgacheffe 250g',
    total_cny: 80,
    buyer: 'Alice',
    created_at: '2026-11-11T08:00:00.000Z',
  },
  {
    id: 'ord_spike_002',
    product: 'Cold Brew 500ml',
    total_cny: 100,
    buyer: 'Bob',
    created_at: '2026-11-11T08:10:00.000Z',
  },
]

const DEFAULT_STATUS: Record<string, OrderStatus> = {
  ord_spike_001: 'payment_submitted',
  ord_spike_002: 'pending_payment',
}

export function parsePaidIds(cookieHeader: string | undefined, shop: string): Set<string> {
  const paid = new Set<string>()
  if (!cookieHeader) return paid
  const match = cookieHeader.match(/(?:^|;\s*)spike_paid=([^;]+)/)
  if (!match) return paid
  try {
    const raw = decodeURIComponent(match[1])
    const data = JSON.parse(raw) as Record<string, string[]>
    for (const id of data[shop] || []) paid.add(id)
  } catch {
    // ignore bad cookie
  }
  return paid
}

export function serializePaidIds(
  cookieHeader: string | undefined,
  shop: string,
  addId: string,
): string {
  const all: Record<string, string[]> = {}
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)spike_paid=([^;]+)/)
    if (match) {
      try {
        Object.assign(all, JSON.parse(decodeURIComponent(match[1])))
      } catch {
        // ignore
      }
    }
  }
  const set = new Set(all[shop] || [])
  set.add(addId)
  all[shop] = [...set]
  return encodeURIComponent(JSON.stringify(all))
}

export function listOrders(shop: string, paidIds: Set<string>) {
  return SEED.map((o) => ({
    ...o,
    shop,
    status: paidIds.has(o.id) ? ('paid' as const) : DEFAULT_STATUS[o.id],
  }))
}

export function getOrder(shop: string, id: string, paidIds: Set<string>) {
  return listOrders(shop, paidIds).find((o) => o.id === id) ?? null
}

export function confirmPayment(
  shop: string,
  id: string,
  amount: number,
  paidIds: Set<string>,
) {
  const order = getOrder(shop, id, paidIds)
  if (!order) return { ok: false as const, error: 'order_not_found' }
  if (order.status !== 'payment_submitted') {
    return { ok: false as const, error: 'invalid_status' }
  }
  if (amount !== order.total_cny) {
    return { ok: false as const, error: 'amount_mismatch' }
  }
  return {
    ok: true as const,
    order: { ...order, status: 'paid' as const },
  }
}

/** Deterministic session token — no shared memory needed across isolates. */
export function createSession(shop: string, key: string) {
  if (key !== 'spike-admin-key') return null
  return `spike.${shop}`
}

export function getSession(token: string | undefined, shop: string) {
  if (!token) return null
  if (token !== `spike.${shop}`) return null
  return { shop }
}
