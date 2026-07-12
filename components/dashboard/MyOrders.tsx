import { formatNaira } from '@/lib/format'
import type { OrderRow } from '@/lib/exchange/orders'

const BUYER_STATUS: Record<string, { label: string; cls: string }> = {
  initiated: { label: 'Awaiting payment', cls: 'text-amber-400' },
  payment_held: { label: 'Payment secured, awaiting delivery', cls: 'text-sky-400' },
  completed: { label: 'Complete — funds released to seller', cls: 'text-emerald-400' },
  refunded: { label: 'Refunded to buyer', cls: 'text-slate-400' },
}

export function MyOrders({ orders }: { orders: OrderRow[] }) {
  if (orders.length === 0) return null
  return (
    <section id="orders" className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">My orders</h2>
      <div className="space-y-2">
        {orders.map((o) => {
          const s = BUYER_STATUS[o.status] ?? { label: o.status, cls: 'text-slate-400' }
          return (
            <div key={o.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
              <p className="truncate font-bold text-white">{o.title}</p>
              <p className="text-xs text-slate-500">
                {formatNaira(o.amount)} · <span className={s.cls}>{s.label}</span>
              </p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
