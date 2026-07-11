import { formatNaira } from '@/lib/format'
import type { OrderRow } from './MyOrders'

const SELLER_STATUS: Record<string, { label: string; cls: string }> = {
  initiated: { label: 'Buyer starting checkout', cls: 'text-amber-400' },
  payment_held: { label: 'Paid — deliver now', cls: 'text-sky-400' },
  completed: { label: 'Complete — funds released to you', cls: 'text-emerald-400' },
  refunded: { label: 'Refunded to buyer', cls: 'text-slate-400' },
}

export function MySales({ sales }: { sales: OrderRow[] }) {
  if (sales.length === 0) return null
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">My sales</h2>
      <div className="space-y-2">
        {sales.map((o) => {
          const s = SELLER_STATUS[o.status] ?? { label: o.status, cls: 'text-slate-400' }
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
