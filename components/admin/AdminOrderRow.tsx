'use client'
import { useFormState } from 'react-dom'
import { formatNaira, formatDateTime } from '@/lib/format'
import { buildZolaruxWhatsAppUrl } from '@/lib/exchange/escrow'
import { cancelOrderAdmin, type ActionState } from '@/lib/exchange/admin-actions'

export interface AdminOrderRow {
  id: string
  listingTitle: string
  amount: number
  status: string
  zolaruxOrderRef: string
  buyerUsername: string | null
  sellerUsername: string | null
  createdAt: string
}

const STATUS_CLS: Record<string, string> = {
  initiated: 'text-amber-400',
  payment_held: 'text-sky-400',
  completed: 'text-emerald-400',
  refunded: 'text-slate-400',
}

export function AdminOrderRow({ order }: { order: AdminOrderRow }) {
  const [cancelState, cancelAction] = useFormState<ActionState, FormData>(cancelOrderAdmin, undefined)
  const href = buildZolaruxWhatsAppUrl({
    listingTitle: order.listingTitle,
    amountNgn: order.amount,
    zolaruxOrderRef: order.zolaruxOrderRef,
    buyerUsername: order.buyerUsername,
    status: order.status,
  })
  const canCancel = order.status === 'initiated' || order.status === 'payment_held'

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate font-bold text-white">{order.listingTitle}</p>
        <p className="mt-0.5 text-xs text-slate-500">
          {formatNaira(order.amount)} ·{' '}
          <span className={STATUS_CLS[order.status] ?? 'text-slate-400'}>{order.status}</span> · @
          {order.buyerUsername ?? 'unknown'} → @{order.sellerUsername ?? 'unknown'} ·{' '}
          {formatDateTime(order.createdAt)}
        </p>
        {cancelState?.error && <p className="mt-1 text-xs text-red-400">{cancelState.error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg border border-[#25D366]/30 px-3 py-1.5 text-xs font-bold text-[#25D366] transition-colors hover:bg-[#25D366]/10"
        >
          Notify Zolarux
        </a>
        {canCancel && (
          <form
            action={cancelAction}
            onSubmit={(e) => {
              if (!window.confirm(`Cancel this order for "${order.listingTitle}"? This marks it refunded and frees up the listing.`)) {
                e.preventDefault()
              }
            }}
          >
            <input type="hidden" name="id" value={order.id} />
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-bold text-red-400 transition-colors hover:bg-red-500/10"
            >
              Cancel order
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
