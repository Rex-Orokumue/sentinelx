'use client'
import { useFormState } from 'react-dom'
import { confirmFriendlyResult, disputeFriendlyResult, type FriendlyAdminState } from '@/lib/friendly-matches/admin-actions'
import { formatNaira } from '@/lib/format'

export interface FriendlySubmission {
  submittedBy: 'challenger' | 'opponent'
  scoreChallenger: number
  scoreOpponent: number
  signedUrl: string | null
}

export interface PendingFriendlyMatch {
  id: string
  challengerName: string
  opponentName: string
  stakeAmount: number | null
  submissions: FriendlySubmission[]
  prefillScoreChallenger: number | null
  prefillScoreOpponent: number | null
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

      <div className="mt-2 space-y-2">
        {req.submissions.map((s) => (
          <div key={s.submittedBy} className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-sm">
            <p className="font-semibold text-white">
              {s.submittedBy === 'challenger' ? req.challengerName : req.opponentName} reported {s.scoreChallenger}–{s.scoreOpponent}
            </p>
            {s.signedUrl && (
              <a href={s.signedUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-violet-400 hover:text-violet-300">
                View screenshot →
              </a>
            )}
          </div>
        ))}
      </div>

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

      <form action={confirmAction} className="mt-3 space-y-2">
        <input type="hidden" name="id" value={req.id} />
        <div className="flex items-end gap-3">
          <ScoreField label={req.challengerName} name="scoreChallenger" defaultValue={req.prefillScoreChallenger ?? undefined} />
          <span className="pb-2 text-slate-500">–</span>
          <ScoreField label={req.opponentName} name="scoreOpponent" defaultValue={req.prefillScoreOpponent ?? undefined} />
        </div>
        <button type="submit" className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500">
          Confirm official result
        </button>
      </form>

      {(confirmState?.error || disputeState?.error) && (
        <p className="mt-2 text-sm text-red-400">{confirmState?.error || disputeState?.error}</p>
      )}
    </div>
  )
}

function ScoreField({ label, name, defaultValue }: { label: string; name: string; defaultValue?: number }) {
  return (
    <div className="flex-1 space-y-1.5">
      <label className="block truncate text-xs font-medium text-slate-400">{label}</label>
      <input
        name={name}
        type="number"
        min={0}
        required
        defaultValue={defaultValue}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-center text-lg font-bold text-white focus:border-violet-500 focus:outline-none"
      />
    </div>
  )
}
