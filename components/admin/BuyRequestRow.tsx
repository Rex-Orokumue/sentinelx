'use client'
import { useState } from 'react'
import { useFormState } from 'react-dom'
import {
  markBuyRequestInProgress,
  markBuyRequestFulfilled,
  closeBuyRequest,
  type ActionState,
} from '@/lib/exchange/requests-admin-actions'
import { canAdminSetStatus, type BuyRequestStatus } from '@/lib/exchange/requests-guards'
import { formatNaira } from '@/lib/format'
import { CATEGORY_LABELS, type ListingCategory } from '@/lib/exchange/schema'
import { WhatsAppChip } from '@/components/shared/WhatsAppChip'

export interface AdminBuyRequest {
  id: string
  title: string
  budget: number
  category: ListingCategory
  status: BuyRequestStatus
  buyerName: string
  whatsappUrl: string | null
}

const STATUS_CLS: Record<BuyRequestStatus, string> = {
  open: 'text-amber-400',
  in_progress: 'text-sky-400',
  fulfilled: 'text-emerald-400',
  closed: 'text-slate-500',
}

export function BuyRequestRow({ request }: { request: AdminBuyRequest }) {
  const [inProgressState, inProgress] = useFormState<ActionState, FormData>(markBuyRequestInProgress, undefined)
  const [fulfilledState, fulfilled] = useFormState<ActionState, FormData>(markBuyRequestFulfilled, undefined)
  const [closeState, close] = useFormState<ActionState, FormData>(closeBuyRequest, undefined)
  const [note, setNote] = useState('')
  const err = inProgressState?.error || fulfilledState?.error || closeState?.error

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="min-w-0">
        <p className="truncate font-bold text-white">{request.title}</p>
        <p className="text-xs text-slate-500">
          {CATEGORY_LABELS[request.category]} · Up to {formatNaira(request.budget)} ·{' '}
          <span className={STATUS_CLS[request.status]}>{request.status}</span> · @{request.buyerName}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canAdminSetStatus(request.status, 'in_progress') && (
          <form action={inProgress}>
            <input type="hidden" name="id" value={request.id} />
            <button type="submit" className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-bold text-white hover:bg-sky-500">
              Mark in-progress
            </button>
          </form>
        )}
        {canAdminSetStatus(request.status, 'fulfilled') && (
          <form action={fulfilled}>
            <input type="hidden" name="id" value={request.id} />
            <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500">
              Mark fulfilled
            </button>
          </form>
        )}
        {canAdminSetStatus(request.status, 'closed') && (
          <form action={close} className="flex items-center gap-2">
            <input type="hidden" name="id" value={request.id} />
            <input
              type="text"
              name="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional)"
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
            />
            <button type="submit" className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-500">
              Close
            </button>
          </form>
        )}
        <WhatsAppChip name={`Message @${request.buyerName}`} url={request.whatsappUrl} />
      </div>

      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
    </div>
  )
}
