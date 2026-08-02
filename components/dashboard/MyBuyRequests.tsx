'use client'
import { useFormState } from 'react-dom'
import { cancelBuyRequest, type ActionState } from '@/lib/exchange/requests-actions'
import { canBuyerCancel, type BuyRequestStatus } from '@/lib/exchange/requests-guards'
import { formatNaira } from '@/lib/format'

export interface MyBuyRequest {
  id: string
  title: string
  budget: number
  status: BuyRequestStatus
}

const STATUS: Record<BuyRequestStatus, { label: string; cls: string }> = {
  open: { label: 'Open', cls: 'text-amber-400' },
  in_progress: { label: 'In progress', cls: 'text-sky-400' },
  fulfilled: { label: 'Fulfilled', cls: 'text-emerald-400' },
  closed: { label: 'Closed', cls: 'text-slate-500' },
}

export function MyBuyRequests({ requests }: { requests: MyBuyRequest[] }) {
  if (requests.length === 0) return null
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-base font-bold text-white">My buy requests</h2>
      <div className="space-y-2">
        {requests.map((r) => (
          <Row key={r.id} request={r} />
        ))}
      </div>
    </section>
  )
}

function Row({ request }: { request: MyBuyRequest }) {
  const [state, action] = useFormState<ActionState, FormData>(cancelBuyRequest, undefined)
  const s = STATUS[request.status]
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="min-w-0">
        <p className="truncate font-bold text-white">{request.title}</p>
        <p className="text-xs text-slate-500">
          Up to {formatNaira(request.budget)} · <span className={s.cls}>{s.label}</span>
        </p>
      </div>
      {canBuyerCancel(request.status) && (
        <form action={action} className="shrink-0">
          <input type="hidden" name="id" value={request.id} />
          <button type="submit" className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-200 hover:border-slate-500">
            Cancel
          </button>
          {state?.error && <span className="ml-2 text-xs text-red-400">{state.error}</span>}
        </form>
      )}
    </div>
  )
}
