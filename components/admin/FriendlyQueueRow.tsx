'use client'
import { useFormState } from 'react-dom'
import { confirmFriendlyResult, disputeFriendlyResult, type FriendlyAdminState } from '@/lib/friendly-matches/admin-actions'
import { formatNaira } from '@/lib/format'

export interface PendingFriendlyMatch {
  id: string
  challengerName: string
  opponentName: string
  stakeAmount: number | null
  scoreChallenger: number | null
  scoreOpponent: number | null
  screenshotUrl: string | null
}

export function FriendlyQueueRow({ req }: { req: PendingFriendlyMatch }) {
  const [confirmState, confirmAction] = useFormState<FriendlyAdminState, FormData>(confirmFriendlyResult, undefined)
  const [disputeState, disputeAction] = useFormState<FriendlyAdminState, FormData>(disputeFriendlyResult, undefined)

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate font-bold text-white">
          {req.challengerName} <span className="text-slate-500">vs</span> {req.opponentName}
        </p>
        {req.stakeAmount && <p className="shrink-0 text-sm font-semibold text-violet-400">{formatNaira(req.stakeAmount)} stake</p>}
      </div>
      <p className="mt-1 text-sm text-slate-300">
        Score: {req.scoreChallenger} – {req.scoreOpponent}
      </p>
      {req.screenshotUrl && (
        <a href={req.screenshotUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs text-violet-400 hover:text-violet-300">
          View screenshot
        </a>
      )}

      <form action={disputeAction} className="mt-3">
        <input type="hidden" name="id" value={req.id} />
        <textarea
          name="note"
          rows={2}
          placeholder="Dispute reason (required to dispute)"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
        />
        <button
          type="submit"
          className="mt-2 rounded-lg border border-red-500/40 px-4 py-2 text-xs font-bold text-red-400 hover:bg-red-500/10"
        >
          Dispute
        </button>
      </form>

      <form action={confirmAction} className="mt-2">
        <input type="hidden" name="id" value={req.id} />
        <button type="submit" className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500">
          Confirm
        </button>
      </form>

      {(confirmState?.error || disputeState?.error) && (
        <p className="mt-2 text-sm text-red-400">{confirmState?.error || disputeState?.error}</p>
      )}
    </div>
  )
}
