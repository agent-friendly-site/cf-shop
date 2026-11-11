/** @jsxImportSource react */
import { useState } from 'react'
import { Button } from '@/app/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog'

type Order = {
  id: string
  shop: string
  product: string
  total_cny: number
  buyer: string
  status: string
  created_at: string
}

type Props = {
  shop: string
}

export default function AdminConsole({ shop }: Props) {
  const [token, setToken] = useState<string | null>(null)
  const [key, setKey] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)
  const [orders, setOrders] = useState<Order[]>([])
  const [selected, setSelected] = useState<Order | null>(null)
  const [amount, setAmount] = useState('')
  const [actionError, setActionError] = useState('')
  const [toast, setToast] = useState('')
  const [confirming, setConfirming] = useState(false)

  async function login(e: React.FormEvent) {
    e.preventDefault()
    setLoggingIn(true)
    setLoginError('')
    try {
      const res = await fetch(`/shops/${shop}/admin/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key }),
      })
      const data = await res.json()
      if (!res.ok) {
        setLoginError(data?.error?.message || '登录失败')
        return
      }
      setToken(data.token)
      await refresh(data.token)
    } catch {
      setLoginError('网络错误，请重试')
    } finally {
      setLoggingIn(false)
    }
  }

  async function refresh(auth = token) {
    if (!auth) return
    const res = await fetch(`/shops/${shop}/admin/api/orders`, {
      headers: { authorization: `Bearer ${auth}` },
      credentials: 'include',
    })
    const data = await res.json()
    if (res.ok) setOrders(data.orders || [])
  }

  async function confirmPayment() {
    if (!token || !selected) return
    setConfirming(true)
    setActionError('')
    try {
      const res = await fetch(
        `/shops/${shop}/admin/api/orders/${selected.id}/confirm-payment`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          credentials: 'include',
          body: JSON.stringify({ amount_cny: Number(amount) }),
        },
      )
      const data = await res.json()
      if (!res.ok) {
        setActionError(data?.error?.message || '确认失败')
        return
      }
      setToast(`已确认收款：${selected.id}`)
      setSelected(null)
      await refresh()
    } catch {
      setActionError('网络错误，请重试')
    } finally {
      setConfirming(false)
    }
  }

  if (!token) {
    return (
      <form onSubmit={login} className="mx-auto mt-10 max-w-sm space-y-4 rounded-lg border border-border p-6">
        <h1 className="text-xl font-semibold">卖家后台（spike）</h1>
        <p className="text-sm text-muted-foreground">店铺：{shop} · 测试 key：spike-admin-key</p>
        <label className="block text-sm">
          Admin Key
          <input
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
          />
        </label>
        {loginError ? <p className="text-sm text-destructive">{loginError}</p> : null}
        <Button type="submit" disabled={loggingIn} className="w-full">
          {loggingIn ? '登录中…' : '登录'}
        </Button>
      </form>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">订单列表 · {shop}</h1>
          <p className="text-sm text-muted-foreground">Phase 0 HonoX + React 岛 + Dialog</p>
        </div>
        <Button variant="outline" onClick={() => refresh()}>
          刷新
        </Button>
      </div>

      {toast ? (
        <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm">{toast}</div>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/60">
            <tr>
              <th className="px-3 py-2">订单</th>
              <th className="px-3 py-2">商品</th>
              <th className="px-3 py-2">金额</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-t border-border">
                <td className="px-3 py-2 font-mono text-xs">{o.id}</td>
                <td className="px-3 py-2">{o.product}</td>
                <td className="px-3 py-2">{o.total_cny} CNY</td>
                <td className="px-3 py-2">{o.status}</td>
                <td className="px-3 py-2 text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setSelected(o)
                      setAmount(String(o.total_cny))
                      setActionError('')
                    }}
                  >
                    详情
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>订单详情</DialogTitle>
            <DialogDescription>
              {selected?.id} · {selected?.buyer} · {selected?.status}
            </DialogDescription>
          </DialogHeader>
          {selected ? (
            <div className="space-y-3">
              <p className="text-sm">
                {selected.product} · 应付 <strong>{selected.total_cny} CNY</strong>
              </p>
              {selected.status === 'payment_submitted' ? (
                <>
                  <label className="block text-sm">
                    核验金额（CNY）
                    <input
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      inputMode="decimal"
                    />
                  </label>
                  {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
                  <Button onClick={confirmPayment} disabled={confirming} className="w-full">
                    {confirming ? '确认中…' : '确认收款'}
                  </Button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">当前状态不可确认收款。</p>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
