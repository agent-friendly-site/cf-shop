import { Hono } from 'hono'
import {
  confirmPayment,
  createSession,
  getOrder,
  getSession,
  listOrders,
  parsePaidIds,
  serializePaidIds,
} from './lib/store'

/**
 * Stand-in for the production code-mounted API/MCP tree.
 * Mounted onto the HonoX app via `.route()` — this is the Phase 0 hybrid-mount proof.
 */
export const api = new Hono()

api.get('/health', (c) =>
  c.json({ status: 'ok', service: 'agent-friendly-honox-spike', version: '0.0.0-spike' }),
)

api.post('/shops/:shop/mcp', async (c) => {
  const shop = c.req.param('shop')
  const body = await c.req.json().catch(() => ({}))
  if (body?.method === 'tools/list') {
    return c.json({
      jsonrpc: '2.0',
      id: body.id ?? 1,
      result: {
        tools: [
          { name: 'list_products', description: 'spike stub' },
          { name: 'create_order', description: 'spike stub' },
        ],
      },
    })
  }
  return c.json({
    jsonrpc: '2.0',
    id: body?.id ?? 1,
    result: { shop, echo: body, note: 'spike mcp stub' },
  })
})

api.post('/shops/:shop/admin/api/login', async (c) => {
  const shop = c.req.param('shop')
  const body = await c.req.json().catch(() => ({}))
  const token = createSession(shop, String(body?.key ?? ''))
  if (!token) {
    return c.json({ error: { code: 'unauthorized', message: 'Key 不对，请检查后重试' } }, 401)
  }
  return c.json({ ok: true, token })
})

api.get('/shops/:shop/admin/api/orders', (c) => {
  const shop = c.req.param('shop')
  const auth = c.req.header('authorization')?.replace(/^Bearer\s+/i, '')
  if (!getSession(auth, shop)) {
    return c.json({ error: { code: 'unauthorized', message: '未登录' } }, 401)
  }
  const paid = parsePaidIds(c.req.header('cookie'), shop)
  return c.json({ orders: listOrders(shop, paid) })
})

api.get('/shops/:shop/admin/api/orders/:id', (c) => {
  const shop = c.req.param('shop')
  const id = c.req.param('id')
  const auth = c.req.header('authorization')?.replace(/^Bearer\s+/i, '')
  if (!getSession(auth, shop)) {
    return c.json({ error: { code: 'unauthorized', message: '未登录' } }, 401)
  }
  const paid = parsePaidIds(c.req.header('cookie'), shop)
  const order = getOrder(shop, id, paid)
  if (!order) return c.json({ error: { code: 'not_found', message: '订单不存在' } }, 404)
  return c.json({ order })
})

api.post('/shops/:shop/admin/api/orders/:id/confirm-payment', async (c) => {
  const shop = c.req.param('shop')
  const id = c.req.param('id')
  const auth = c.req.header('authorization')?.replace(/^Bearer\s+/i, '')
  if (!getSession(auth, shop)) {
    return c.json({ error: { code: 'unauthorized', message: '未登录' } }, 401)
  }
  const body = await c.req.json().catch(() => ({}))
  const amount = Number(body?.amount_cny)
  const cookie = c.req.header('cookie')
  const paid = parsePaidIds(cookie, shop)
  const result = confirmPayment(shop, id, amount, paid)
  if (!result.ok) {
    const message =
      result.error === 'amount_mismatch'
        ? '金额与订单总额不符'
        : result.error === 'invalid_status'
          ? '订单状态不允许确认收款'
          : '订单不存在'
    return c.json({ error: { code: result.error, message } }, 400)
  }
  const value = serializePaidIds(cookie, shop, id)
  c.header(
    'Set-Cookie',
    `spike_paid=${value}; Path=/; Max-Age=86400; SameSite=Lax`,
  )
  return c.json({ ok: true, order: result.order })
})
